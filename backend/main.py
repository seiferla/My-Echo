import logging
import os
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import mistral_tts
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


def _resolve_provider(value: str) -> str:
    """Returns "mistral" (default) or "mock". A typo stops the start, so paid speech never switches silently."""
    value = (value or "mistral").strip().lower()
    if value not in ("mistral", "mock"):
        raise RuntimeError(f"TTS_PROVIDER must be 'mistral' or 'mock', got {value!r}")
    return value


# "mock" sends silent MP3 instead of calling Mistral. For load tests only.
TTS_PROVIDER = _resolve_provider(os.getenv("TTS_PROVIDER", "mistral"))


@app.get("/warmup", dependencies=[Depends(current_user)])
async def warmup():
    """Opens a TTS connection in advance (called when the user starts typing)."""
    if TTS_PROVIDER == "mock":
        return {"status": "warm"}
    return await mistral_tts.warm_up()


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

    return StreamingResponse(
        mistral_tts.stream(text),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health():
    base = {"voice": mistral_tts.VOICE, "model": mistral_tts.MODEL, "provider": TTS_PROVIDER}
    if TTS_PROVIDER == "mock":
        return {**base, "status": "ok"}  # no call to Mistral, so the mock runs without a key
    return {**base, **await mistral_tts.check_health()}


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
