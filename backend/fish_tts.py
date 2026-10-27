"""Fish Audio TTS (TTS_PROVIDER=fish): live WebSocket stream, warm connection, health check.

Settings (env, read at import):
  TTS_API_KEY        Fish Audio API key
  TTS_MODEL          model, default s2-pro
  TTS_VOICE          reference id of the voice
  TTS_LATENCY        "balanced" (default) is the best trade-off between first audio and quality
  TTS_CHUNK_LENGTH   token chunk size, default 50
"""
import asyncio
import contextlib
import logging
import os
import time
from collections.abc import AsyncIterator

import httpx
import msgpack
import websockets

logger = logging.getLogger("myecho.tts")

API_KEY = os.getenv("TTS_API_KEY", "")
WS_URL = "wss://api.fish.audio/v1/tts/live"
CREDIT_URL = "https://api.fish.audio/wallet/self/api-credit"
MODEL = os.getenv("TTS_MODEL", "s2-pro")
VOICE = os.getenv("TTS_VOICE", "")
LATENCY = os.getenv("TTS_LATENCY", "balanced")

# Fish default is 200. Smaller values give earlier first audio;
# 50 fits typical AAC messages (2–200 characters).
try:
    CHUNK_LENGTH = int(os.getenv("TTS_CHUNK_LENGTH", "50"))
except ValueError:
    CHUNK_LENGTH = 50

# --- Pre-warmed connection ------------------------------------------------------
_warm = {"ws": None, "ts": 0.0}
_warm_lock = asyncio.Lock()
WARM_TTL_SECONDS = 25.0


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {API_KEY}",
        "model": MODEL,
    }


def _start_payload() -> bytes:
    return msgpack.packb({
        "event": "start",
        "request": {
            "text": "",
            "format": "mp3",
            "latency": LATENCY,
            "chunk_length": CHUNK_LENGTH,
            "reference_id": VOICE,
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


async def _open_connection():
    """Opens a Fish Audio connection and sends the start event."""
    ws = await websockets.connect(WS_URL, additional_headers=_headers())
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


async def warm_up() -> dict:
    """Opens a connection in advance, so a send later saves the handshake and the start round trip."""
    async with _warm_lock:
        if _warm["ws"] is not None:
            await _close_quietly(_warm["ws"])
            _warm["ws"] = None
        try:
            _warm["ws"] = await _open_connection()
            _warm["ts"] = time.monotonic()
            return {"status": "warm"}
        except Exception:
            return {"status": "error", "message": "Internal server error"}


async def stream(text: str) -> AsyncIterator[bytes]:
    """Yields the MP3 audio of the text chunk by chunk. Uses the warm connection if there is one."""
    t_start = time.monotonic()

    ws = await _take_warm_connection()
    warm = ws is not None
    opened_fresh = False
    if ws is None:
        ws = await _open_connection()
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
            ws = await _open_connection()
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
                        CHUNK_LENGTH,
                        LATENCY,
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


async def check_health() -> dict:
    """Checks the API key with a cheap call. Returns {"status": ...} plus a "message" on errors."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(CREDIT_URL, headers=_headers())
            response.raise_for_status()
            # Do not return the credit: /health is public.
            return {"status": "ok"}
        except httpx.TimeoutException:
            return {"status": "unavailable", "message": "Fish Audio API Timeout"}
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception:
            return {"status": "error", "message": "Internal server error"}
