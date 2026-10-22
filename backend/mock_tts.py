"""Mock-Sprachsynthese für Lasttests (Issue #217, Ziel G5).

Ersetzt Fish Audio, wenn TTS_PROVIDER=mock gesetzt ist. So misst ein Lasttest nur
das eigene System, kostet nichts und läuft ohne API-Key.

Das Audio ist eine gültige MP3 aus Stille (128 kbit/s, 44,1 kHz, mono). Zwei
Größen sind einstellbar, damit der Mock wie der echte Dienst aussieht:
  - Wartezeit bis zum ersten Byte (beim echten Dienst die Synthesezeit)
  - Länge des Audios, abhängig von der Textlänge (also auch die Datenmenge)

Einstellungen (Umgebungsvariablen, werden bei jedem Aufruf gelesen):
  MOCK_TTS_FIRST_AUDIO_MS    Wartezeit bis zum ersten Byte        Standard 1500
  MOCK_TTS_CHUNK_MS          Pause zwischen zwei Datenstücken     Standard 20
  MOCK_TTS_CHARS_PER_SECOND  Zeichen pro Sekunde gesprochen       Standard 15
"""
import asyncio
import logging
import math
import os
from typing import AsyncIterator

logger = logging.getLogger("myecho.tts")

# MPEG-1 Layer III, 128 kbit/s, 44,1 kHz, mono, ohne CRC, ohne Padding.
# Kopf FF FB 90 C0, danach lauter Nullen: ein gültiges Bild, das als Stille klingt.
FRAME_BYTES = 417                      # 144 * 128000 / 44100, abgerundet
FRAME_SECONDS = 1152 / 44100           # ein Bild dauert etwa 26 ms
SILENT_FRAME = bytes([0xFF, 0xFB, 0x90, 0xC0]) + bytes(FRAME_BYTES - 4)

CHUNK_BYTES = 4096                     # Größe der gestreamten Stücke
MIN_SECONDS = 0.5                      # auch sehr kurze Texte ergeben etwas Audio


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
    """Eine MP3 aus Stille mit (ungefähr) der gewünschten Länge."""
    return SILENT_FRAME * math.ceil(seconds / FRAME_SECONDS)


async def stream(text: str) -> AsyncIterator[bytes]:
    """Liefert das Audio wie der echte Dienst: erst warten, dann Stück für Stück."""
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
        # Nur Längen loggen, nie den Text (G8).
        logger.info("TTS (mock) finished: chars=%d, bytes=%d", len(text), sent)
