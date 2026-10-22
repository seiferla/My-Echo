"""Fake TTS for load tests (TTS_PROVIDER=mock): silent MP3, no Fish Audio, no cost.

Settings (env, read on every call):
  MOCK_TTS_FIRST_AUDIO_MS    delay until the first byte     default 1500
  MOCK_TTS_CHUNK_MS          pause between two chunks       default 20
  MOCK_TTS_CHARS_PER_SECOND  sets the audio length          default 15
"""
import asyncio
import logging
import math
import os
from collections.abc import AsyncIterator

logger = logging.getLogger("myecho.tts")

# One MPEG-1 Layer III frame (128 kbit/s, 44.1 kHz, mono): header FF FB 90 C0,
# then zeros. A valid frame that sounds like silence.
FRAME_BYTES = 417                      # 144 * 128000 / 44100, rounded down
FRAME_SECONDS = 1152 / 44100           # about 26 ms
SILENT_FRAME = bytes([0xFF, 0xFB, 0x90, 0xC0]) + bytes(FRAME_BYTES - 4)

CHUNK_BYTES = 4096
MIN_SECONDS = 0.5                      # very short texts still get some audio


def _env_number(name: str, default: float) -> float:
    try:
        return max(0.0, float(os.getenv(name, default)))
    except ValueError:
        return default


def first_audio_ms() -> float:
    return _env_number("MOCK_TTS_FIRST_AUDIO_MS", 1500)


def chunk_ms() -> float:
    return _env_number("MOCK_TTS_CHUNK_MS", 20)


def audio_seconds(text: str) -> float:
    chars_per_second = _env_number("MOCK_TTS_CHARS_PER_SECOND", 15) or 15
    return max(MIN_SECONDS, len(text) / chars_per_second)


def silent_mp3(seconds: float) -> bytes:
    return SILENT_FRAME * math.ceil(seconds / FRAME_SECONDS)


async def stream(text: str) -> AsyncIterator[bytes]:
    """Behaves like the real service: wait first, then send the audio chunk by chunk."""
    await asyncio.sleep(first_audio_ms() / 1000)
    data = silent_mp3(audio_seconds(text))
    pause = chunk_ms() / 1000
    sent = 0
    try:
        for start in range(0, len(data), CHUNK_BYTES):
            piece = data[start:start + CHUNK_BYTES]
            sent += len(piece)
            yield piece
            if pause:
                await asyncio.sleep(pause)
    finally:
        # Log lengths only, never the text.
        logger.info("TTS (mock) finished: chars=%d, bytes=%d", len(text), sent)
