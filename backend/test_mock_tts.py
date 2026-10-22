"""Tests für den Mock-TTS (Issue #217, G5).

Wichtigste Regel: Im Mock-Betrieb darf NIE eine Verbindung zu Fish Audio entstehen.
Jeder Versuch lässt den Test mit einem Fehler abbrechen.
"""
import os
import time
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

import main
import mock_tts
from auth import current_user

FAST_MOCK = {"MOCK_TTS_FIRST_AUDIO_MS": "0", "MOCK_TTS_CHUNK_MS": "0"}


def _forbid_fish():
    """Jeder Zugriff auf Fish Audio wird zum Testfehler."""
    boom = AssertionError("Fish Audio must not be used in mock mode")
    return [
        patch.object(main, "_open_fish_connection", AsyncMock(side_effect=boom)),
        patch.object(main, "_take_warm_connection", AsyncMock(side_effect=boom)),
        patch.object(main.httpx, "AsyncClient", MagicMock(side_effect=boom)),
        patch.object(main.websockets, "connect", AsyncMock(side_effect=boom)),
    ]


class MockMode(unittest.TestCase):
    """Basisklasse: Mock an, Fish gesperrt, eingeloggter Nutzer."""

    def setUp(self):
        patches = [
            patch.object(main, "TTS_PROVIDER", "mock"),
            patch.dict(os.environ, FAST_MOCK),
            *_forbid_fish(),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        main.app.dependency_overrides[current_user] = lambda: "user-1"
        self.addCleanup(main.app.dependency_overrides.pop, current_user, None)
        self.client = TestClient(main.app)  # ohne "with": kein Lifespan, keine Datenbank


class TestAudioFile(unittest.TestCase):
    def test_silent_mp3_is_made_of_whole_valid_frames(self):
        data = mock_tts.silent_mp3(2.0)
        self.assertEqual(len(data) % mock_tts.FRAME_BYTES, 0)
        for i in range(0, len(data), mock_tts.FRAME_BYTES):
            self.assertEqual(data[i:i + 2], b"\xff\xfb")  # MPEG-1 Layer III, Synchronwort

    def test_length_follows_the_requested_duration(self):
        seconds = len(mock_tts.silent_mp3(4.0)) / mock_tts.FRAME_BYTES * mock_tts.FRAME_SECONDS
        self.assertAlmostEqual(seconds, 4.0, delta=0.05)

    def test_longer_text_gives_longer_audio(self):
        short, long = mock_tts.audio_seconds("Hallo"), mock_tts.audio_seconds("Hallo " * 40)
        self.assertGreater(long, short)
        self.assertEqual(short, mock_tts.MIN_SECONDS)  # sehr kurze Texte haben ein Minimum

    def test_bad_settings_fall_back_to_defaults(self):
        with patch.dict(os.environ, {"MOCK_TTS_FIRST_AUDIO_MS": "viel", "MOCK_TTS_CHARS_PER_SECOND": "0"}):
            self.assertEqual(mock_tts.first_audio_ms(), 1500)
            self.assertGreater(mock_tts.audio_seconds("x" * 30), 0)  # nie durch 0 teilen


class TestStreamEndpoint(MockMode):
    def test_returns_audio_without_touching_fish(self):
        r = self.client.get("/stream/tts", params={"text": "Hallo Welt"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.headers["content-type"], "audio/mpeg")
        self.assertEqual(r.headers["x-tts-provider"], "mock")
        self.assertEqual(r.content, mock_tts.silent_mp3(mock_tts.audio_seconds("Hallo Welt")))

    def test_longer_text_sends_more_bytes(self):
        short = self.client.get("/stream/tts", params={"text": "Hallo"}).content
        long = self.client.get("/stream/tts", params={"text": "Hallo " * 40}).content
        self.assertGreater(len(long), len(short))

    def test_first_byte_waits_for_the_configured_delay(self):
        with patch.dict(os.environ, {"MOCK_TTS_FIRST_AUDIO_MS": "300"}):
            start = time.monotonic()
            with self.client.stream("GET", "/stream/tts", params={"text": "Hallo"}) as r:
                first = next(r.iter_bytes())
            waited = time.monotonic() - start
        self.assertGreater(len(first), 0)
        self.assertGreaterEqual(waited, 0.28)
        self.assertLess(waited, 1.0)

    def test_still_needs_a_token(self):
        main.app.dependency_overrides.pop(current_user, None)
        self.assertEqual(self.client.get("/stream/tts", params={"text": "Hallo"}).status_code, 401)

    def test_log_has_lengths_but_never_the_text(self):
        from test_logging import LogCapture
        with LogCapture() as logs:
            self.client.get("/stream/tts", params={"text": "Text-der-nie-im-Log-steht"})
        self.assertTrue(any("TTS (mock) finished" in line for line in logs.lines), logs.lines)
        self.assertFalse([line for line in logs.lines if "nie-im-Log" in line])


class TestWarmupAndHealth(MockMode):
    def test_warmup_opens_no_connection(self):
        r = self.client.get("/warmup")
        self.assertEqual(r.json(), {"status": "warm"})

    def test_health_is_ok_without_fish_and_names_the_provider(self):
        r = self.client.get("/health")
        self.assertEqual(r.json()["status"], "ok")
        self.assertEqual(r.json()["provider"], "mock")


class TestProviderSwitch(unittest.TestCase):
    def test_default_is_fish(self):
        self.assertEqual(main._resolve_provider(""), "fish")
        self.assertEqual(main._resolve_provider("fish"), "fish")

    def test_mock_is_accepted_in_any_case(self):
        self.assertEqual(main._resolve_provider(" Mock "), "mock")

    def test_a_typo_stops_the_start(self):
        with self.assertRaises(RuntimeError):
            main._resolve_provider("moc")

    def test_health_reports_fish_when_not_mocked(self):
        with patch.object(main, "TTS_PROVIDER", "fish"), \
             patch.object(main.httpx, "AsyncClient") as client_class:
            client = AsyncMock()
            client.__aenter__.return_value = client
            client.get.return_value = MagicMock(status_code=200)
            client_class.return_value = client
            import asyncio
            result = asyncio.run(main.health())
        self.assertEqual(result["provider"], "fish")


if __name__ == "__main__":
    unittest.main()
