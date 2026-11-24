"""Mistral Voxtral TTS (TTS_PROVIDER=mistral): stateless HTTP/SSE streaming.

Settings (env, read at import):
  TTS_API_KEY    Mistral API key
  TTS_MODEL      Voxtral TTS model, default voxtral-mini-tts-3-0
  TTS_VOICE      voice id (preset or custom); empty = model default voice

Mistral limits new requests per second. 429 and 5xx answers are retried with
backoff before the first audio byte, so a speech request waits instead of failing.
"""
import asyncio
import base64
import json
import logging
import os
import random
import time
from collections.abc import AsyncIterator

import httpx
from prometheus_client import Counter

from emotion_tags import apply_emotion_tags

logger = logging.getLogger("myecho.tts")

API_KEY = os.getenv("TTS_API_KEY", "")
SPEECH_URL = "https://api.mistral.ai/v1/audio/speech"
MODELS_URL = "https://api.mistral.ai/v1/models"
VOICES_URL = "https://api.mistral.ai/v1/audio/voices"
MODEL = os.getenv("TTS_MODEL", "voxtral-mini-tts-3-0")
VOICE = os.getenv("TTS_VOICE", "")

# Retries of 429 and 5xx (before any audio was sent). Wait = base * 2^attempt + jitter, capped.
MAX_RETRIES = 3
RETRY_BASE_DELAY = 0.5
RETRY_MAX_DELAY = 8.0

# Shown at /metrics as mistral_429_total.
MISTRAL_429 = Counter("mistral_429", "Mistral answered HTTP 429 (too many requests)")

# Generous streaming timeout so long messages finish.
TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)


def _headers() -> dict:
    return {"Authorization": f"Bearer {API_KEY}"}


def _is_retryable(status_code: int) -> bool:
    return status_code == 429 or status_code >= 500


def _retry_delay(attempt: int, response: httpx.Response) -> float:
    """Seconds to wait before the next try. Uses Retry-After (seconds) if Mistral sends it."""
    try:
        return min(float(response.headers["retry-after"]), RETRY_MAX_DELAY)
    except (KeyError, ValueError, TypeError):
        pass
    return min(RETRY_BASE_DELAY * 2**attempt, RETRY_MAX_DELAY) + random.uniform(0, 0.25)


def _payload(text: str, voice_id: str = "") -> dict:
    payload = {
        "input": apply_emotion_tags(text),
        "model": MODEL,
        "response_format": "mp3",
        "stream": True,
    }
    voice = voice_id or VOICE
    if voice:
        payload["voice_id"] = voice
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


async def stream(text: str, voice_id: str = "") -> AsyncIterator[bytes]:
    """Yields the MP3 audio of the text chunk by chunk, spoken with the given voice."""
    t_start = time.monotonic()
    first_audio_logged = False
    chunk_count = 0
    byte_count = 0
    voice = voice_id or VOICE

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            for attempt in range(MAX_RETRIES + 1):
                delay = None
                async with client.stream(
                    "POST", SPEECH_URL, json=_payload(text, voice_id), headers=_headers()
                ) as response:
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError:
                        await response.aread()
                        _log_api_error("TTS", response, voice)
                        if response.status_code == 429:
                            MISTRAL_429.inc()
                        if not _is_retryable(response.status_code) or attempt == MAX_RETRIES:
                            raise
                        delay = _retry_delay(attempt, response)
                    else:
                        async for chunk in _iter_audio(response):
                            if not first_audio_logged:
                                first_audio_logged = True
                                logger.info(
                                    "TTS first audio: %d ms total, chars=%d, model=%s, voice=%s",
                                    int((time.monotonic() - t_start) * 1000),
                                    len(text),
                                    MODEL,
                                    voice or "default",
                                )
                            chunk_count += 1
                            byte_count += len(chunk)
                            yield chunk
                        return
                logger.info("Mistral busy, retry %d/%d in %.1f s", attempt + 1, MAX_RETRIES, delay)
                await asyncio.sleep(delay)
    finally:
        logger.info(
            "TTS finished: %d ms total, %d audio chunks, %d bytes",
            int((time.monotonic() - t_start) * 1000),
            chunk_count,
            byte_count,
        )


def _log_api_error(action: str, response: httpx.Response, voice: str | None = None) -> None:
    """Logs status and Mistral's error message. Never the request (it holds the user's text)."""
    logger.warning(
        "Mistral %s failed: HTTP %d, voice=%s, response=%s",
        action,
        response.status_code,
        voice or "none",
        response.text[:300],
    )


async def warm_up() -> dict:
    """Voxtral is stateless HTTP, so there is no connection to pre-warm."""
    return {"status": "warm"}


async def check_health() -> dict:
    """Checks the API key with a cheap call. Returns {"status": ...} plus a "message" on errors."""
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


async def create_voice(sample_audio_b64: str, filename: str, name: str) -> str:
    """Creates a cloned voice from a base64-encoded audio sample. Returns the voice id.

    The sample stays at Mistral according to retention_notice (default 30 days);
    the returned voice id is what the TTS requests use.
    """
    payload = {
        "name": name,
        "sample_audio": sample_audio_b64,
        "sample_filename": filename,
        "retention_notice": 30,
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(VOICES_URL, json=payload, headers=_headers())
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError:
            _log_api_error("create voice", response)
            raise
        return response.json()["id"]


async def delete_voice(voice_id: str) -> None:
    """Deletes a cloned voice at Mistral. Best effort: a missing voice raises, the caller logs it."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.delete(f"{VOICES_URL}/{voice_id}", headers=_headers())
        response.raise_for_status()
