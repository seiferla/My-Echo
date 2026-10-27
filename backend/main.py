import contextlib
import os
import time
import asyncio
import logging
import msgpack
import httpx
import websockets
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import mock_tts
from auth import CurrentUser, current_user, require_metrics_token
from db import (
    init_db, close_db, list_chats, upsert_chat, delete_chat,
    get_phrase_store, put_phrase_store, get_tts_stats, merge_tts_stats,
)
from schemas import (
    MAX_MESSAGE_CHARS, MAX_STAT_DAYS, ChatModel, DayKey, PhraseStoreModel, TtsDayStatModel,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myecho.tts")


class StripQueryFromAccessLog(logging.Filter):
    """Removes the query string from the Uvicorn access log, so /stream/tts?text=... never logs the text."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # Uvicorn passes "path?query" as the third argument.
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


logging.getLogger("uvicorn.access").addFilter(StripQueryFromAccessLog())


@asynccontextmanager
async def lifespan(app: FastAPI):
    if TTS_PROVIDER == "mock":
        logger.warning("TTS_PROVIDER=mock: there is NO real speech. For load tests only.")
    await init_db()
    yield
    await close_db()


# No Swagger UI and no OpenAPI file: they would list every route publicly.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
Instrumentator().instrument(app).expose(
    app, include_in_schema=False, dependencies=[Depends(require_metrics_token)]
)


def rate_limit_key(request: Request) -> str:
    """One counter per signed-in user, so users behind the same IP do not share a limit.

    auth.current_user sets request.state.user_id. Without a verified user, the IP is used.
    """
    user_id = getattr(request.state, "user_id", None)
    return f"user:{user_id}" if user_id else f"ip:{get_remote_address(request)}"


def _tts_rate_limit() -> str:
    # Read on every request, so tests and load tests can change it.
    return os.getenv("RATE_LIMIT_TTS", "30/minute")


# Only /stream/tts has a limit, because every request costs money.
limiter = Limiter(key_func=rate_limit_key)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Extra browser origins (e.g. a hosted web version), comma-separated.
EXTRA_CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",   # Expo web
        "http://localhost:19006",  # Expo web (alt)
        "exp://*",                 # Expo Go (native)
        *EXTRA_CORS_ORIGINS,
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FISH_API_KEY = os.getenv("TTS_API_KEY", "")
WS_URL = "wss://api.fish.audio/v1/tts/live"
FISH_CREDIT_URL = "https://api.fish.audio/wallet/self/api-credit"
AUDIO_MODEL = os.getenv("TTS_MODEL", "s2-pro")
AUDIO_REFERENCE_ID = os.getenv("TTS_VOICE", "")


def _resolve_provider(value: str) -> str:
    """Returns "fish" (default) or "mock". A typo stops the start, so paid speech never switches silently."""
    value = (value or "fish").strip().lower()
    if value not in ("fish", "mock"):
        raise RuntimeError(f"TTS_PROVIDER must be 'fish' or 'mock', got {value!r}")
    return value


# "mock" sends silent MP3 instead of calling Fish Audio. For load tests only.
TTS_PROVIDER = _resolve_provider(os.getenv("TTS_PROVIDER", "fish"))

# "balanced" is the best trade-off between time to first audio and quality.
AUDIO_LATENCY = os.getenv("TTS_LATENCY", "balanced")

# Token chunk size (Fish default 200). Smaller values give earlier first audio;
# 50 fits typical AAC messages (2–200 characters).
try:
    AUDIO_CHUNK_LENGTH = int(os.getenv("TTS_CHUNK_LENGTH", "50"))
except ValueError:
    AUDIO_CHUNK_LENGTH = 50

# --- Pre-warmed Fish connection -----------------------------------------------
_warm = {"ws": None, "ts": 0.0}
_warm_lock = asyncio.Lock()
WARM_TTL_SECONDS = 25.0


def _fish_headers() -> dict:
    return {
        "Authorization": f"Bearer {FISH_API_KEY}",
        "model": AUDIO_MODEL,
    }


def _start_payload() -> bytes:
    return msgpack.packb({
        "event": "start",
        "request": {
            "text": "",
            "format": "mp3",
            "latency": AUDIO_LATENCY,
            "chunk_length": AUDIO_CHUNK_LENGTH,
            "reference_id": AUDIO_REFERENCE_ID,
            "prosody": {
                "speed": 0.85,
                "volume": 0,
            }
        }
    })


async def _close_quietly(ws) -> None:
    with contextlib.suppress(Exception):
        await ws.close()


async def _send_text(ws, text: str) -> None:
    """Sends the text and asks Fish to synthesize it and then close the stream."""
    await ws.send(msgpack.packb({"event": "text", "text": text}))
    await ws.send(msgpack.packb({"event": "flush"}))
    await ws.send(msgpack.packb({"event": "stop"}))


async def _open_fish_connection():
    """Opens a Fish Audio connection and sends the start event."""
    ws = await websockets.connect(WS_URL, additional_headers=_fish_headers())
    await ws.send(_start_payload())
    return ws


async def _take_warm_connection():
    """Returns the pre-warmed connection if it is fresh enough, else None. Takes it out of the state."""
    async with _warm_lock:
        ws = _warm["ws"]
        age = time.monotonic() - _warm["ts"]
        _warm["ws"] = None
        if ws is not None and age < WARM_TTL_SECONDS:
            return ws
        if ws is not None:
            await _close_quietly(ws)
        return None


@app.get("/warmup", dependencies=[Depends(current_user)])
async def warmup():
    """Opens a Fish connection in advance (called when the user starts typing).

    This saves the handshake and the start round trip when the message is sent.
    """
    if TTS_PROVIDER == "mock":
        return {"status": "warm"}
    async with _warm_lock:
        if _warm["ws"] is not None:
            await _close_quietly(_warm["ws"])
            _warm["ws"] = None
        try:
            _warm["ws"] = await _open_fish_connection()
            _warm["ts"] = time.monotonic()
            return {"status": "warm"}
        except Exception:
            return {"status": "error", "message": "Internal server error"}


@app.get("/stream/tts", dependencies=[Depends(current_user)])
@limiter.limit(_tts_rate_limit)
async def stream_tts(
    request: Request,
    text: Annotated[str, Query(min_length=1, max_length=MAX_MESSAGE_CHARS)],
):
    if TTS_PROVIDER == "mock":
        return StreamingResponse(
            mock_tts.stream(text),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "no-cache",
                "X-TTS-Provider": "mock",
                # The load test subtracts this delay to measure only our own system.
                "X-TTS-Mock-First-Audio-Ms": str(int(mock_tts.first_audio_ms())),
            },
        )

    async def generate():
        t_start = time.monotonic()

        # Use the pre-warmed connection, else open a new one.
        ws = await _take_warm_connection()
        warm = ws is not None
        opened_fresh = False
        if ws is None:
            ws = await _open_fish_connection()
            opened_fresh = True

        first_audio_logged = False
        chunk_count = 0
        byte_count = 0

        try:
            # The start event is already sent (warm or fresh).
            try:
                await _send_text(ws, text)
            except Exception:
                # The warm connection was dead: retry once with a fresh one.
                if opened_fresh:
                    raise
                await _close_quietly(ws)
                ws = await _open_fish_connection()
                await _send_text(ws, text)
            t_sent = time.monotonic()

            async for message in ws:
                msg = msgpack.unpackb(message)
                if msg.get("event") == "audio":
                    if not first_audio_logged:
                        first_audio_logged = True
                        t_first_audio = time.monotonic()
                        logger.info(
                            "TTS first audio: %d ms after text sent (%d ms total), "
                            "chars=%d, warm=%s, chunk_length=%d, latency=%s",
                            int((t_first_audio - t_sent) * 1000),
                            int((t_first_audio - t_start) * 1000),
                            len(text),
                            warm,
                            AUDIO_CHUNK_LENGTH,
                            AUDIO_LATENCY,
                        )
                    chunk_count += 1
                    byte_count += len(msg["audio"])
                    yield msg["audio"]
                elif msg.get("event") == "finish":
                    break
        finally:
            logger.info(
                "TTS finished: %d ms total, %d audio chunks, %d bytes",
                int((time.monotonic() - t_start) * 1000),
                chunk_count,
                byte_count,
            )
            await _close_quietly(ws)

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health():
    base = {"voice": AUDIO_REFERENCE_ID, "model": AUDIO_MODEL, "provider": TTS_PROVIDER}

    if TTS_PROVIDER == "mock":
        return {**base, "status": "ok"}  # no call to Fish, so the mock runs without a key

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(FISH_CREDIT_URL, headers=_fish_headers())
            response.raise_for_status()
            # Do not return the credit: this route is public.
            return {**base, "status": "ok"}
        except httpx.TimeoutException:
            return {**base, "status": "unavailable", "message": "Fish Audio API Timeout"}
        except httpx.HTTPStatusError as e:
            return {**base, "status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception:
            return {**base, "status": "error", "message": "Internal server error"}


@app.get("/chats", response_model=list[ChatModel])
async def get_chats(user_id: CurrentUser):
    return await list_chats(user_id)


@app.put("/chats/{chat_id}")
async def put_chat(chat_id: str, chat: ChatModel, user_id: CurrentUser):
    """Creates the chat or replaces it completely."""
    if chat.id != chat_id:
        raise HTTPException(400, "chat_id mismatch between URL and body")
    await upsert_chat(user_id, chat.model_dump())
    return {"status": "ok"}


@app.delete("/chats/{chat_id}")
async def remove_chat(chat_id: str, user_id: CurrentUser):
    deleted = await delete_chat(user_id, chat_id)
    if not deleted:
        raise HTTPException(404, f"chat {chat_id} not found")
    return {"status": "deleted"}


@app.get("/phrases", response_model=PhraseStoreModel | None)
async def get_phrases(user_id: CurrentUser):
    """Returns null when the user has no phrases yet."""
    return await get_phrase_store(user_id)


@app.put("/phrases")
async def put_phrases(store: PhraseStoreModel, user_id: CurrentUser):
    """An older store never replaces a newer one; then the answer is "stale"."""
    stored = await put_phrase_store(user_id, store.model_dump())
    return {"status": "ok" if stored else "stale"}


@app.get("/stats/tts", response_model=dict[str, TtsDayStatModel])
async def get_stats_tts(user_id: CurrentUser):
    return await get_tts_stats(user_id)


@app.post("/stats/tts")
async def post_stats_tts(stats: dict[DayKey, TtsDayStatModel], user_id: CurrentUser):
    """Per field the larger value wins, so the numbers never go down."""
    if len(stats) > MAX_STAT_DAYS:
        raise HTTPException(413, f"too many days (max {MAX_STAT_DAYS})")
    await merge_tts_stats(user_id, {day: s.model_dump() for day, s in stats.items()})
    return {"status": "ok"}
