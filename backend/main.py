import os
import time
import json
import base64
import logging
import httpx
from contextlib import asynccontextmanager
from typing import Optional, AsyncIterator
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from db import init_db, close_db, list_chats, upsert_chat, delete_chat

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myecho.tts")

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


# --- Lifespan: DB beim Start initialisieren, beim Stop schließen ------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(lifespan=lifespan)
Instrumentator().instrument(app).expose(app)

# Rate limiting: single-user app, generous limits to prevent API abuse
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: allow mobile app (Expo) and local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",   # Expo web
        "http://localhost:19006",  # Expo web (alt)
        "exp://*",                 # Expo Go (native)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MISTRAL_API_KEY = os.getenv("TTS_API_KEY", "")
SPEECH_URL = "https://api.mistral.ai/v1/audio/speech"
AUDIO_MODEL = os.getenv("TTS_MODEL", "voxtral-mini-tts-3-0")
AUDIO_VOICE_ID = os.getenv("TTS_VOICE", "")

# Streaming-Timeout: Verbindungsaufbau 10 s, Lesen bis zu 120 s — großzügig,
# damit auch längere Nachrichten vollständig gestreamt werden.
TTS_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)


def _mistral_headers() -> dict:
    return {"Authorization": f"Bearer {MISTRAL_API_KEY}"}


def _speech_payload(text: str) -> dict:
    payload = {
        "input": text,
        "model": AUDIO_MODEL,
        "response_format": "mp3",
        "stream": True,
    }
    if AUDIO_VOICE_ID:
        payload["voice_id"] = AUDIO_VOICE_ID
    return payload


def _parse_sse_event(data_lines: list) -> tuple[bool, list]:
    """Parst ein SSE-Event (Liste von data:-Zeilen) zu (done, [audio_bytes])."""
    payload = "\n".join(data_lines)
    if not payload:
        return False, []
    try:
        obj = json.loads(payload)
    except json.JSONDecodeError:
        return False, []
    if obj.get("type") == "speech.audio.done":
        return True, []
    audio = obj.get("audio_data")
    if not audio:
        return False, []
    try:
        return False, [base64.b64decode(audio)]
    except Exception:
        return False, []


async def _iter_mistral_audio(response) -> AsyncIterator[bytes]:
    """Iteriert über die SSE-Antwort und liefert dekodierte Audio-Bytes."""
    data_lines: list = []
    done = False
    async for line in response.aiter_lines():
        if line == "":
            done, chunks = _parse_sse_event(data_lines)
            data_lines = []
            for chunk in chunks:
                yield chunk
            if done:
                break
        elif line.startswith("data:"):
            data_lines.append(line[len("data:"):].strip())
    if not done and data_lines:
        _, chunks = _parse_sse_event(data_lines)
        for chunk in chunks:
            yield chunk


@app.get("/stream/tts")
@limiter.limit("30/minute")
async def stream_tts(request: Request, text: str):
    async def generate():
        t_start = time.monotonic()
        first_audio_logged = False
        chunk_count = 0
        byte_count = 0

        try:
            async with httpx.AsyncClient(timeout=TTS_TIMEOUT) as client:
                async with client.stream(
                    "POST", SPEECH_URL, json=_speech_payload(text), headers=_mistral_headers()
                ) as response:
                    response.raise_for_status()
                    async for chunk in _iter_mistral_audio(response):
                        if not first_audio_logged:
                            first_audio_logged = True
                            logger.info(
                                "TTS first audio: %d ms total, chars=%d, model=%s, voice=%s",
                                int((time.monotonic() - t_start) * 1000),
                                len(text),
                                AUDIO_MODEL,
                                AUDIO_VOICE_ID or "default",
                            )
                        chunk_count += 1
                        byte_count += len(chunk)
                        yield chunk
        finally:
            logger.info(
                "TTS finished: %d ms total, %d audio chunks, %d bytes",
                int((time.monotonic() - t_start) * 1000),
                chunk_count,
                byte_count,
            )

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health():
    url = "https://api.mistral.ai/v1/models"
    headers = _mistral_headers()

    base = {"voice": AUDIO_VOICE_ID, "model": AUDIO_MODEL}

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            models = response.json().get("data", [])
            return {**base, "status": "ok", "models": len(models)}
        except httpx.TimeoutException:
            return {**base, "status": "unavailable", "message": "Mistral API Timeout"}
        except httpx.HTTPStatusError as e:
            return {**base, "status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception:
            return {**base, "status": "error", "message": "Internal server error"}


# --- Endpoints (am Ende der Datei ergänzen) ---------------------------------

@app.get("/chats", response_model=list[ChatModel])
async def get_chats():
    """Alle Chats laden — wird beim App-Start aufgerufen."""
    return await list_chats()


@app.put("/chats/{chat_id}")
async def put_chat(chat_id: str, chat: ChatModel):
    """Chat anlegen oder komplett ersetzen."""
    if chat.id != chat_id:
        raise HTTPException(400, "chat_id mismatch between URL and body")
    await upsert_chat(chat.model_dump())
    return {"status": "ok"}


@app.delete("/chats/{chat_id}")
async def remove_chat(chat_id: str):
    deleted = await delete_chat(chat_id)
    if not deleted:
        raise HTTPException(404, f"chat {chat_id} not found")
    return {"status": "deleted"}
