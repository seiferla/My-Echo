import os
import time
import asyncio
import msgpack
import httpx
import websockets
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator

from db import init_db, close_db, list_chats, upsert_chat, delete_chat

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

FISH_API_KEY = os.getenv("TTS_API_KEY", "")
WS_URL = "wss://api.fish.audio/v1/tts/live"
AUDIO_MODEL = os.getenv("TTS_MODEL", "s2-pro")
AUDIO_REFERENCE_ID = os.getenv("TTS_VOICE", "")

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
            "latency": "normal",
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
async def warmup():
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
async def stream_tts(text: str):
    async def generate():
        # 1. Vorgewärmte Verbindung nutzen, sonst frisch öffnen
        ws = await _take_warm_connection()
        opened_fresh = False
        if ws is None:
            ws = await _open_fish_connection()
            opened_fresh = True

        try:
            # 2. Text senden (start ist bereits gesendet — warm oder fresh)
            try:
                await ws.send(msgpack.packb({"event": "text", "text": text}))
                await ws.send(msgpack.packb({"event": "flush"}))
                await ws.send(msgpack.packb({"event": "stop"}))
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
                else:
                    raise

            # 3. Audio-Chunks streamen
            async for message in ws:
                msg = msgpack.unpackb(message)
                if msg.get("event") == "audio":
                    yield msg["audio"]
                elif msg.get("event") == "finish":
                    break
        finally:
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
            return {**base, "status": "ok", "credits": response.json()}
        except httpx.TimeoutException:
            return {**base, "status": "unavailable", "message": "Fish Audio API Timeout"}
        except httpx.HTTPStatusError as e:
            return {**base, "status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception as e:
            return {**base, "status": "error", "message": str(e)}


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
