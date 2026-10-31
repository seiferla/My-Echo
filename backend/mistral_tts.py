"""Mistral Voxtral TTS (TTS_PROVIDER=mistral): stateless HTTP/SSE streaming.

Settings (env, read at import):
  TTS_API_KEY    Mistral API key
  TTS_MODEL      Voxtral TTS model, default voxtral-mini-tts-2603
  TTS_VOICE      voice id (preset or custom). REQUIRED: Mistral has no default voice
"""
import base64
import json
import logging
import os
import time
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger("myecho.tts")

API_KEY = os.getenv("TTS_API_KEY", "")
SPEECH_URL = "https://api.mistral.ai/v1/audio/speech"
MODELS_URL = "https://api.mistral.ai/v1/models"
MODEL = os.getenv("TTS_MODEL", "voxtral-mini-tts-2603")
VOICE = os.getenv("TTS_VOICE", "")
if not VOICE:
    logger.error("TTS_VOICE is not set: Mistral rejects every speech request without a voice id.")

# Generous streaming timeout so long messages finish.
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)


def _headers() -> dict:
    return {"Authorization": f"Bearer {API_KEY}"}


def _payload(text: str) -> dict:
    payload = {
        "input": text,
        "model": MODEL,
        "response_format": "mp3",
        "stream": True,
    }
    if VOICE:
        payload["voice_id"] = VOICE
    return payload


def _parse_sse_event(data_lines: list) -> tuple[bool, list]:
    """Parse one SSE event (data: lines) into (done, [audio_bytes])."""
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


async def _iter_audio(response) -> AsyncIterator[bytes]:
    """Yield decoded audio bytes from the SSE stream."""
    data_lines = []
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


async def stream(text: str) -> AsyncIterator[bytes]:
    """Yields the MP3 audio of the text chunk by chunk."""
    t_start = time.monotonic()
    first_audio_logged = False
    chunk_count = 0
    byte_count = 0

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream(
                "POST", SPEECH_URL, json=_payload(text), headers=_headers()
            ) as response:
                response.raise_for_status()
                async for chunk in _iter_audio(response):
                    if not first_audio_logged:
                        first_audio_logged = True
                        logger.info(
                            "TTS first audio: %d ms total, chars=%d, model=%s, voice=%s",
                            int((time.monotonic() - t_start) * 1000),
                            len(text),
                            MODEL,
                            VOICE or "default",
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


async def warm_up() -> dict:
    """Voxtral is stateless HTTP, so there is no connection to pre-warm."""
    return {"status": "warm"}


async def check_health() -> dict:
    """Checks voice and API key. Returns {"status": ...} plus a "message" on errors."""
    if not VOICE:
        return {"status": "error", "message": "TTS_VOICE is not set (Mistral needs a voice id)"}
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(MODELS_URL, headers=_headers())
            response.raise_for_status()
            return {"status": "ok"}
        except httpx.TimeoutException:
            return {"status": "unavailable", "message": "Mistral API Timeout"}
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception:
            return {"status": "error", "message": "Internal server error"}
