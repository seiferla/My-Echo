import os
import time
import asyncio
import logging
import msgpack
import httpx
import websockets
from contextlib import asynccontextmanager
from typing import Annotated, Optional
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, StringConstraints
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from auth import current_user, require_metrics_token
from db import (
    init_db, close_db, list_chats, upsert_chat, delete_chat,
    get_phrase_store, put_phrase_store, get_tts_stats, merge_tts_stats,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myecho.tts")


class StripQueryFromAccessLog(logging.Filter):
    """Entfernt den Query-String aus dem Uvicorn-Zugriffslog (G8).

    /stream/tts?text=... würde sonst den Nachrichtentext ins Log schreiben,
    solange der Text noch in der URL steht. Uvicorn übergibt den Pfad mit
    Query-String als drittes Argument der Logzeile.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = (*args[:2], args[2].split("?", 1)[0], *args[3:])
        return True


logging.getLogger("uvicorn.access").addFilter(StripQueryFromAccessLog())

# --- Pydantic-Modelle (vor app = FastAPI(...) einfügen) ---------------------

class MessageModel(BaseModel):
    id: str
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=10_000)
    timestamp: Optional[int] = None
    via: Optional[str] = Field(None, pattern="^(send|save)$")
    editCount: int = 0


class ChatModel(BaseModel):
    id: str
    title: str = Field(max_length=200)
    timestamp: int
    pinned: bool = False
    messages: list[MessageModel] = []


class PhraseModel(BaseModel):
    id: str = Field(max_length=100)
    text: str = Field(min_length=1, max_length=1000)
    useCount: int = Field(0, ge=0, le=1_000_000_000)
    lastUsedAt: Optional[int] = None
    createdAt: int


class PhraseSettingsModel(BaseModel):
    visibleCount: int = Field(ge=0, le=20)
    instantEnabled: bool


class PhraseStoreModel(BaseModel):
    phrases: list[PhraseModel] = Field(default=[], max_length=200)
    settings: PhraseSettingsModel
    updatedAt: int = Field(ge=0)  # Zeitpunkt der letzten Änderung (ms), der neuere Stand gewinnt


# Tag wie in der App: YYYY-MM-DD
DayKey = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
MAX_STAT_DAYS = 800


class TtsDayStatModel(BaseModel):
    requests: int = Field(ge=0, le=1_000_000_000)
    chars: int = Field(ge=0, le=1_000_000_000)
    durationMs: int = Field(ge=0, le=10**12)


# --- Lifespan: DB beim Start initialisieren, beim Stop schließen ------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


# Swagger-UI und OpenAPI-Datei sind aus: sie würden alle Routen öffentlich zeigen.
app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
# /metrics nur für Prometheus mit eigenem Token (METRICS_TOKEN), nicht öffentlich.
Instrumentator().instrument(app).expose(
    app, include_in_schema=False, dependencies=[Depends(require_metrics_token)]
)

# Rate limiting: single-user app, generous limits to prevent API abuse
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: allow mobile app (Expo) and local dev origins.
# Weitere Browser-Herkünfte (z. B. eine gehostete Web-Version) über
# CORS_ORIGINS, kommagetrennt.
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
AUDIO_MODEL = os.getenv("TTS_MODEL", "s2-pro")
AUDIO_REFERENCE_ID = os.getenv("TTS_VOICE", "")

# Standard hier: "balanced" — bester TTFA/Qualitäts-Kompromiss fürs Streaming
AUDIO_LATENCY = os.getenv("TTS_LATENCY", "balanced")

# chunk_length: Token-Chunkgröße (typ. 30–300, Fish-Default 200). Kleinere
# Werte erzwingen früheres erstes Audio (schnellere TTFA). 50 ist ein guter
# Kompromiss für typische AAC-Nachrichten (2–200 Zeichen).
try:
    AUDIO_CHUNK_LENGTH = int(os.getenv("TTS_CHUNK_LENGTH", "50"))
except ValueError:
    AUDIO_CHUNK_LENGTH = 50

# --- Pre-Warming State -------------------------------------------------------
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


async def _open_fish_connection():
    """Öffnet eine Fish-Audio-Verbindung und sendet das start-Event."""
    ws = await websockets.connect(WS_URL, additional_headers=_fish_headers())
    await ws.send(_start_payload())
    return ws


async def _take_warm_connection():
    """
    Gibt eine vorgewärmte Verbindung zurück (und entfernt sie aus dem State),
    falls eine frische genug existiert. Sonst None.
    """
    async with _warm_lock:
        ws = _warm["ws"]
        age = time.monotonic() - _warm["ts"]
        _warm["ws"] = None
        if ws is not None and age < WARM_TTL_SECONDS:
            return ws
        # zu alt: aufräumen
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass
        return None


@app.get("/warmup")
async def warmup(user_id: str = Depends(current_user)):
    """
    Öffnet vorab eine Fish-Audio-Verbindung und sendet das start-Event.
    Vom Frontend aufgerufen sobald der User das Eingabefeld öffnet —
    spart beim späteren Senden den Handshake + start-Roundtrip.
    """
    async with _warm_lock:
        if _warm["ws"] is not None:
            try:
                await _warm["ws"].close()
            except Exception:
                pass
            _warm["ws"] = None
        try:
            _warm["ws"] = await _open_fish_connection()
            _warm["ts"] = time.monotonic()
            return {"status": "warm"}
        except Exception:
            return {"status": "error", "message": "Internal server error"}


@app.get("/stream/tts")
@limiter.limit("30/minute")
async def stream_tts(request: Request, text: str, user_id: str = Depends(current_user)):
    async def generate():
        t_start = time.monotonic()

        # 1. Vorgewärmte Verbindung nutzen, sonst frisch öffnen
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
            # 2. Text senden (start ist bereits gesendet — warm oder fresh)
            try:
                await ws.send(msgpack.packb({"event": "text", "text": text}))
                await ws.send(msgpack.packb({"event": "flush"}))
                await ws.send(msgpack.packb({"event": "stop"}))
                t_sent = time.monotonic()
            except Exception:
                # Warme Verbindung war doch tot → einmal frisch neu versuchen
                if not opened_fresh:
                    try:
                        await ws.close()
                    except Exception:
                        pass
                    ws = await _open_fish_connection()
                    await ws.send(msgpack.packb({"event": "text", "text": text}))
                    await ws.send(msgpack.packb({"event": "flush"}))
                    await ws.send(msgpack.packb({"event": "stop"}))
                    t_sent = time.monotonic()
                else:
                    raise

            # 3. Audio-Chunks streamen
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
            try:
                await ws.close()
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health():
    url = "https://api.fish.audio/wallet/self/api-credit"
    headers = {"Authorization": f"Bearer {FISH_API_KEY}", "model": AUDIO_MODEL}

    base = {"voice": AUDIO_REFERENCE_ID, "model": AUDIO_MODEL}

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            # Guthaben nicht ausgeben: das Backend ist öffentlich erreichbar.
            return {**base, "status": "ok"}
        except httpx.TimeoutException:
            return {**base, "status": "unavailable", "message": "Fish Audio API Timeout"}
        except httpx.HTTPStatusError as e:
            return {**base, "status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception:
            return {**base, "status": "error", "message": "Internal server error"}


# --- Endpoints (am Ende der Datei ergänzen) ---------------------------------

@app.get("/chats", response_model=list[ChatModel])
async def get_chats(user_id: str = Depends(current_user)):
    """Alle Chats des angemeldeten Nutzers — wird beim App-Start aufgerufen."""
    return await list_chats(user_id)


@app.put("/chats/{chat_id}")
async def put_chat(chat_id: str, chat: ChatModel, user_id: str = Depends(current_user)):
    """Chat des angemeldeten Nutzers anlegen oder komplett ersetzen."""
    if chat.id != chat_id:
        raise HTTPException(400, "chat_id mismatch between URL and body")
    await upsert_chat(user_id, chat.model_dump())
    return {"status": "ok"}


@app.delete("/chats/{chat_id}")
async def remove_chat(chat_id: str, user_id: str = Depends(current_user)):
    deleted = await delete_chat(user_id, chat_id)
    if not deleted:
        raise HTTPException(404, f"chat {chat_id} not found")
    return {"status": "deleted"}


@app.get("/phrases", response_model=Optional[PhraseStoreModel])
async def get_phrases(user_id: str = Depends(current_user)):
    """Phrasen + Einstellungen des angemeldeten Nutzers, oder null wenn es noch keine gibt."""
    return await get_phrase_store(user_id)


@app.put("/phrases")
async def put_phrases(store: PhraseStoreModel, user_id: str = Depends(current_user)):
    """Speichert den Stand. Ein älterer Stand überschreibt keinen neueren ("stale")."""
    stored = await put_phrase_store(user_id, store.model_dump())
    return {"status": "ok" if stored else "stale"}


@app.get("/stats/tts", response_model=dict[str, TtsDayStatModel])
async def get_stats_tts(user_id: str = Depends(current_user)):
    """Alle TTS-Tageswerte des angemeldeten Nutzers."""
    return await get_tts_stats(user_id)


@app.post("/stats/tts")
async def post_stats_tts(stats: dict[DayKey, TtsDayStatModel], user_id: str = Depends(current_user)):
    """Führt Tageswerte zusammen: pro Feld gilt der größere Wert, die Zahlen werden nie kleiner."""
    if len(stats) > MAX_STAT_DAYS:
        raise HTTPException(413, f"too many days (max {MAX_STAT_DAYS})")
    await merge_tts_stats(user_id, {day: s.model_dump() for day, s in stats.items()})
    return {"status": "ok"}
