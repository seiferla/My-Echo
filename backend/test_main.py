import base64
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

import mistral_tts


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class _FakeStreamResponse:
    """Fake SSE response for _iter_audio."""

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
    """Wire httpx.AsyncClient so stream() returns the fake SSE response."""
    fake_response = _FakeStreamResponse(chunks)
    mock_client = AsyncMock()
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False

    stream_cm = AsyncMock()
    stream_cm.__aenter__.return_value = fake_response
    stream_cm.__aexit__.return_value = False

    # stream() must return the async CM synchronously (no await), else
    # `async with client.stream(...)` fails on a coroutine.
    mock_client.stream = MagicMock(return_value=stream_cm)

    mock_client_class.return_value = mock_client
    return fake_response


class TestPayload(unittest.TestCase):
    """Tests for _payload."""

    def test_payload_with_voice(self):
        with patch("mistral_tts.MODEL", "voxtral-mini-tts-3-0"), \
             patch("mistral_tts.VOICE", "voice-abc"):
            payload = mistral_tts._payload("Hallo")

        self.assertEqual(payload["input"], "Hallo")
        self.assertEqual(payload["model"], "voxtral-mini-tts-3-0")
        self.assertEqual(payload["response_format"], "mp3")
        self.assertTrue(payload["stream"])
        self.assertEqual(payload["voice_id"], "voice-abc")

    def test_payload_without_voice_has_no_voice_id(self):
        with patch("mistral_tts.VOICE", ""):
            payload = mistral_tts._payload("Hallo")

        self.assertNotIn("voice_id", payload)

    def test_payload_prefers_the_passed_voice_over_the_global_one(self):
        with patch("mistral_tts.VOICE", "global-voice"):
            payload = mistral_tts._payload("Hallo", voice_id="user-voice")

        self.assertEqual(payload["voice_id"], "user-voice")

    def test_payload_with_empty_passed_voice_falls_back_to_global(self):
        with patch("mistral_tts.VOICE", "global-voice"):
            payload = mistral_tts._payload("Hallo", voice_id="")

        self.assertEqual(payload["voice_id"], "global-voice")


class TestParseSseEvent(unittest.TestCase):
    """Tests for _parse_sse_event."""

    def test_done_event_returns_done(self):
        done, chunks = mistral_tts._parse_sse_event(['{"type": "speech.audio.done", "usage": {}}'])
        self.assertTrue(done)
        self.assertEqual(chunks, [])

    def test_audio_delta_decodes_base64(self):
        done, chunks = mistral_tts._parse_sse_event(
            [f'{{"type": "speech.audio.delta", "audio_data": "{_b64(b"chunk")}"}}']
        )
        self.assertFalse(done)
        self.assertEqual(chunks, [b"chunk"])

    def test_invalid_json_is_ignored(self):
        done, chunks = mistral_tts._parse_sse_event(["not json"])
        self.assertFalse(done)
        self.assertEqual(chunks, [])

    def test_missing_audio_data_is_ignored(self):
        done, chunks = mistral_tts._parse_sse_event(['{"type": "speech.audio.delta"}'])
        self.assertFalse(done)
        self.assertEqual(chunks, [])


class TestIterAudio(unittest.IsolatedAsyncioTestCase):
    """Tests for _iter_audio."""

    async def test_yields_decoded_chunks_and_stops_on_done(self):
        response = _FakeStreamResponse([b"chunk1", b"chunk2"])
        collected = [c async for c in mistral_tts._iter_audio(response)]
        self.assertEqual(collected, [b"chunk1", b"chunk2"])


class TestStream(unittest.IsolatedAsyncioTestCase):
    """Tests for stream()."""

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_streams_audio_bytes(self, mock_client_class):
        _install_stream_mock(mock_client_class, [b"chunk1", b"chunk2"])

        collected = b"".join([c async for c in mistral_tts.stream("Hallo Welt")])

        self.assertEqual(collected, b"chunk1chunk2")

    @patch("mistral_tts._payload")
    @patch("mistral_tts.httpx.AsyncClient")
    async def test_stream_passes_the_user_voice_id(self, mock_client_class, mock_payload):
        _install_stream_mock(mock_client_class, [b"chunk1"])
        mock_payload.return_value = {"input": "x", "model": "m", "stream": True}

        b"".join([c async for c in mistral_tts.stream("Hallo", voice_id="user-voice")])

        mock_payload.assert_called_once_with("Hallo", "user-voice")


class TestWarmup(unittest.IsolatedAsyncioTestCase):
    """Tests for warm_up()."""

    async def test_warmup_is_a_noop(self):
        self.assertEqual(await mistral_tts.warm_up(), {"status": "warm"})


class TestHealth(unittest.IsolatedAsyncioTestCase):
    """Tests for check_health()."""

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_health_ok(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.return_value = MagicMock(status_code=200, json=lambda: {"data": []})
        mock_client_class.return_value = mock_client

        self.assertEqual(await mistral_tts.check_health(), {"status": "ok"})

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_health_timeout(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")
        mock_client_class.return_value = mock_client

        result = await mistral_tts.check_health()

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["message"], "Mistral API Timeout")

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_health_http_error(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_client.get.side_effect = httpx.HTTPStatusError(
            "Unauthorized", request=MagicMock(), response=mock_resp
        )
        mock_client_class.return_value = mock_client

        result = await mistral_tts.check_health()

        self.assertEqual(result["status"], "error")
        self.assertIn("401", result["message"])

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_health_generic_exception(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = Exception("Unexpected")
        mock_client_class.return_value = mock_client

        result = await mistral_tts.check_health()

        self.assertEqual(result["status"], "error")
        self.assertEqual(result["message"], "Internal server error")


class TestCreateVoice(unittest.IsolatedAsyncioTestCase):
    """Tests for create_voice()."""

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_posts_sample_and_returns_voice_id(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"id": "voice-123"}
        mock_client.post.return_value = mock_resp
        mock_client_class.return_value = mock_client

        voice_id = await mistral_tts.create_voice("aGVsbG8=", "sample.mp3", "My voice")

        self.assertEqual(voice_id, "voice-123")
        payload = mock_client.post.call_args.kwargs["json"]
        self.assertEqual(payload["name"], "My voice")
        self.assertEqual(payload["sample_audio"], "aGVsbG8=")
        self.assertEqual(payload["sample_filename"], "sample.mp3")
        self.assertEqual(payload["retention_notice"], 30)

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_raises_on_mistral_error(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_client.post.side_effect = httpx.HTTPStatusError(
            "Bad Request", request=MagicMock(), response=mock_resp
        )
        mock_client_class.return_value = mock_client

        with self.assertRaises(httpx.HTTPStatusError):
            await mistral_tts.create_voice("aGVsbG8=", "sample.mp3", "My voice")


class TestDeleteVoice(unittest.IsolatedAsyncioTestCase):
    """Tests for delete_voice()."""

    @patch("mistral_tts.httpx.AsyncClient")
    async def test_deletes_voice_by_id(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False
        mock_client.delete.return_value = MagicMock()
        mock_client_class.return_value = mock_client

        await mistral_tts.delete_voice("voice-123")

        url = mock_client.delete.call_args.args[0]
        self.assertEqual(url, "https://api.mistral.ai/v1/audio/voices/voice-123")
