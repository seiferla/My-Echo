import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import main
from starlette.requests import Request


def _mock_request():
    """Mock-Request für Tests, die rate-limitierte Endpunkte direkt aufrufen."""
    req = MagicMock(spec=Request)
    req.client.host = "127.0.0.1"
    return req


async def _fake_stream(text):
    yield b"abc"
    yield b"def"


class TestEndpoints(unittest.IsolatedAsyncioTestCase):
    async def test_stream_tts_returns_mp3_stream(self):
        with patch("main.mistral_tts.stream", _fake_stream):
            response = await main.stream_tts(_mock_request(), "Hallo Welt")
            body = b"".join([c async for c in response.body_iterator])

        self.assertEqual(response.media_type, "audio/mpeg")
        self.assertEqual(response.headers["Cache-Control"], "no-cache")
        self.assertEqual(body, b"abcdef")

    async def test_warmup_delegates_to_mistral(self):
        with patch("main.mistral_tts.warm_up", AsyncMock(return_value={"status": "warm"})):
            self.assertEqual(await main.warmup(), {"status": "warm"})

    async def test_health_merges_provider_info_and_status(self):
        with patch("main.mistral_tts.check_health", AsyncMock(return_value={"status": "ok"})):
            result = await main.health()

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["provider"], "mistral")
        self.assertIn("model", result)


if __name__ == "__main__":
    unittest.main()
