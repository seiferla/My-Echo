import base64
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import main
from starlette.requests import Request


def _mock_request():
    """Build a mock Request for tests that call rate-limited endpoints directly."""
    req = MagicMock(spec=Request)
    req.client.host = "127.0.0.1"
    return req


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class _FakeStreamResponse:
    """Minimale SSE-Response zum Testen von _iter_mistral_audio."""

    def __init__(self, chunks):
        self._lines = []
        for c in chunks:
            self._lines.append(f'data: {{"type": "speech.audio.delta", "audio_data": "{_b64(c)}"}}')
            self._lines.append("")
        self._lines.append('data: {"type": "speech.audio.done", "usage": {}}')
        self._lines.append("")

    def raise_for_status(self):
        pass

    async def aiter_lines(self):
        for line in self._lines:
            yield line


def _install_stream_mock(mock_client_class, chunks):
    """Verdrahtet httpx.AsyncClient so, dass stream() die Fake-SSE-Response liefert."""
    fake_response = _FakeStreamResponse(chunks)
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False

    stream_cm = AsyncMock()
    stream_cm.__aenter__.return_value = fake_response
    stream_cm.__aexit__.return_value = False

    # stream(...) muss synchron den Async-Context-Manager zurückgeben (kein
    # await), sonst scheitert `async with client.stream(...)` an einem coroutine.
    mock_client.stream = MagicMock(return_value=stream_cm)

    mock_client_class.return_value = mock_client
    return fake_response


class TestSpeechPayload(unittest.TestCase):
    """Tests für _speech_payload."""

    def test_payload_with_voice(self):
        with patch("main.AUDIO_MODEL", "voxtral-mini-tts-3-0"), \
             patch("main.AUDIO_VOICE_ID", "voice-abc"):
            payload = main._speech_payload("Hallo")

        self.assertEqual(payload["input"], "Hallo")
        self.assertEqual(payload["model"], "voxtral-mini-tts-3-0")
        self.assertEqual(payload["response_format"], "mp3")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["voice_id"], "voice-abc")

    def test_payload_without_voice_has_no_voice_id(self):
        with patch("main.AUDIO_VOICE_ID", ""):
            payload = main._speech_payload("Hallo")

        self.assertNotIn("voice_id", payload)


class TestParseSseEvent(unittest.TestCase):
    """Tests für _parse_sse_event."""

    def test_done_event_returns_done(self):
        done, chunks = main._parse_sse_event(['{"type": "speech.audio.done", "usage": {}}'])
        self.assertTrue(done)
        self.assertEqual(chunks, [])

    def test_audio_delta_decodes_base64(self):
        done, chunks = main._parse_sse_event(
            [f'{{"type": "speech.audio.delta", "audio_data": "{_b64(b"chunk")}"}}']
        )
        self.assertFalse(done)
        self.assertEqual(chunks, [b"chunk"])

    def test_invalid_json_is_ignored(self):
        done, chunks = main._parse_sse_event(["not json"])
        self.assertFalse(done)
        self.assertEqual(chunks, [])

    def test_missing_audio_data_is_ignored(self):
        done, chunks = main._parse_sse_event(['{"type": "speech.audio.delta"}'])
        self.assertFalse(done)
        self.assertEqual(chunks, [])


class TestIterMistralAudio(unittest.IsolatedAsyncioTestCase):
    """Tests für _iter_mistral_audio."""

    async def test_yields_decoded_chunks_and_stops_on_done(self):
        response = _FakeStreamResponse([b"chunk1", b"chunk2"])
        collected = [c async for c in main._iter_mistral_audio(response)]
        self.assertEqual(collected, [b"chunk1", b"chunk2"])


class TestStreamTts(unittest.IsolatedAsyncioTestCase):
    """Tests für den HTTP-Streaming-Endpunkt /stream/tts."""

    @patch("main.httpx.AsyncClient")
    async def test_streams_audio_bytes(self, mock_client_class):
        _install_stream_mock(mock_client_class, [b"chunk1", b"chunk2"])

        response = await main.stream_tts(_mock_request(), "Hallo Welt")
        collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")

    @patch("main.httpx.AsyncClient")
    async def test_response_media_type_is_audio_mpeg(self, mock_client_class):
        _install_stream_mock(mock_client_class, [b"chunk1"])

        response = await main.stream_tts(_mock_request(), "Audio-Typ Test")

        self.assertEqual(response.media_type, "audio/mpeg")


class TestHealthEndpoint(unittest.IsolatedAsyncioTestCase):
    """Tests für den /health-Endpunkt."""

    @patch("main.httpx.AsyncClient")
    async def test_health_success_includes_voice_and_model(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"data": [{"id": "voxtral-mini-tts-3-0"}]},
        )
        mock_client_class.return_value = mock_client

        with patch("main.AUDIO_VOICE_ID", "voice-abc"), \
             patch("main.AUDIO_MODEL", "voxtral-mini-tts-3-0"):
            response = await main.health()

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["models"], 1)
        self.assertEqual(response["voice"], "voice-abc")
        self.assertEqual(response["model"], "voxtral-mini-tts-3-0")

    @patch("main.httpx.AsyncClient")
    async def test_health_timeout_still_returns_voice_and_model(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")
        mock_client_class.return_value = mock_client

        with patch("main.AUDIO_VOICE_ID", "voice-abc"), \
             patch("main.AUDIO_MODEL", "voxtral-mini-tts-3-0"):
            response = await main.health()

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["message"], "Mistral API Timeout")
        self.assertEqual(response["voice"], "voice-abc")
        self.assertEqual(response["model"], "voxtral-mini-tts-3-0")

    @patch("main.httpx.AsyncClient")
    async def test_health_http_error_returns_error_status(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_resp
        )
        mock_client_class.return_value = mock_client

        response = await main.health()

        self.assertEqual(response["status"], "error")
        self.assertIn("401", response["message"])

    @patch("main.httpx.AsyncClient")
    async def test_health_generic_exception_returns_error(self, mock_client_class):
        """Unerwartete Exception wird ohne interne Details als error zurückgegeben."""
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = Exception("Unexpected error")
        mock_client_class.return_value = mock_client

        response = await main.health()

        self.assertEqual(response["status"], "error")
        self.assertEqual("Internal server error", response["message"])
