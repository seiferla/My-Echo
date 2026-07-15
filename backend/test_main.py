import time
import unittest
import msgpack
from unittest.mock import AsyncMock, MagicMock, patch

import main


class TestHelperFunctions(unittest.IsolatedAsyncioTestCase):
    """Tests für _open_fish_connection und _take_warm_connection (51-53, 61-73)."""

    async def test_open_fish_connection_connects_and_sends_start(self):
        mock_ws = AsyncMock()
        with patch("main.websockets.connect", AsyncMock(return_value=mock_ws)), \
             patch("main.FISH_API_KEY", "test_key"), \
             patch("main.AUDIO_REFERENCE_ID", "ref"):
            result = await main._open_fish_connection()

        self.assertIs(result, mock_ws)
        mock_ws.send.assert_awaited_once()

    async def test_take_warm_connection_returns_fresh_connection(self):
        fresh_ws = AsyncMock()
        main._warm["ws"] = fresh_ws
        main._warm["ts"] = time.monotonic()

        result = await main._take_warm_connection()

        self.assertIs(result, fresh_ws)
        self.assertIsNone(main._warm["ws"])

    async def test_take_warm_connection_closes_expired_and_returns_none(self):
        expired_ws = AsyncMock()
        main._warm["ws"] = expired_ws
        main._warm["ts"] = time.monotonic() - (main.WARM_TTL_SECONDS + 1)

        result = await main._take_warm_connection()

        self.assertIsNone(result)
        expired_ws.close.assert_awaited_once()

    async def test_take_warm_connection_returns_none_when_empty(self):
        main._warm["ws"] = None

        result = await main._take_warm_connection()

        self.assertIsNone(result)



class TestStreamTts(unittest.IsolatedAsyncioTestCase):
    """Tests für den HTTP-Streaming-Endpunkt /stream/tts."""

    def _make_ws_mock(self, chunks=None):
        chunks = chunks or [b"chunk1", b"chunk2"]
        mock_ws = AsyncMock()
        messages = [msgpack.packb({"event": "audio", "audio": c}) for c in chunks]
        messages.append(msgpack.packb({"event": "finish"}))
        mock_ws.__aiter__.return_value = messages
        return mock_ws

    async def test_uses_warm_connection_when_available(self):
        warm_ws = self._make_ws_mock()

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=warm_ws)):
            response = await main.stream_tts("Hallo Welt")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")
        self.assertEqual(warm_ws.send.await_count, 3)

    async def test_opens_fresh_connection_when_no_warm(self):
        fresh_ws = self._make_ws_mock()

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=None)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=fresh_ws)):
            response = await main.stream_tts("Test")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")
        self.assertEqual(fresh_ws.send.await_count, 3)

    async def test_retries_with_fresh_connection_when_warm_is_dead(self):
        dead_ws = AsyncMock()
        dead_ws.send.side_effect = Exception("Connection closed")

        fresh_ws = self._make_ws_mock()

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=dead_ws)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=fresh_ws)):
            response = await main.stream_tts("Retry test")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")

    async def test_close_exception_during_retry_is_silenced(self):
        """Lines 120-121: ws.close() wirft während Retry-Cleanup — wird ignoriert."""
        dead_ws = AsyncMock()
        dead_ws.send.side_effect = Exception("dead")
        dead_ws.close.side_effect = Exception("close also failed")

        fresh_ws = self._make_ws_mock()

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=dead_ws)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=fresh_ws)):
            response = await main.stream_tts("Close exception test")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")

    async def test_raises_when_fresh_connection_send_fails(self):
        """Line 127: opened_fresh=True und send schlägt fehl → Exception propagiert."""
        failing_ws = AsyncMock()
        failing_ws.send.side_effect = Exception("Network error")

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=None)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=failing_ws)):
            response = await main.stream_tts("fail")
            with self.assertRaises(Exception):
                async for _ in response.body_iterator:
                    pass

    async def test_close_exception_in_finally_is_silenced(self):
        """Lines 139-140: ws.close() wirft in finally — Exception wird ignoriert."""
        ws = self._make_ws_mock()
        ws.close.side_effect = Exception("close failed")

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=ws)):
            response = await main.stream_tts("finally test")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")

    async def test_response_media_type_is_audio_mpeg(self):
        ws = self._make_ws_mock()
        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=None)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=ws)):
            response = await main.stream_tts("Audio-Typ Test")
            self.assertEqual(response.media_type, "audio/mpeg")


class TestWarmup(unittest.IsolatedAsyncioTestCase):
    """Tests für den /warmup-Endpunkt."""

    async def test_warmup_opens_connection_and_returns_warm(self):
        mock_ws = AsyncMock()

        with patch.object(main, "_open_fish_connection", AsyncMock(return_value=mock_ws)):
            main._warm["ws"] = None
            result = await main.warmup()

        self.assertEqual(result, {"status": "warm"})
        self.assertIs(main._warm["ws"], mock_ws)

    async def test_warmup_replaces_existing_connection(self):
        old_ws = AsyncMock()
        new_ws = AsyncMock()
        main._warm["ws"] = old_ws

        with patch.object(main, "_open_fish_connection", AsyncMock(return_value=new_ws)):
            result = await main.warmup()

        self.assertEqual(result, {"status": "warm"})
        old_ws.close.assert_awaited_once()
        self.assertIs(main._warm["ws"], new_ws)

    async def test_warmup_close_exception_is_silenced(self):
        """Lines 88-89: close() wirft beim Ersetzen — Exception wird ignoriert."""
        old_ws = AsyncMock()
        old_ws.close.side_effect = Exception("close failed")
        new_ws = AsyncMock()
        main._warm["ws"] = old_ws

        with patch.object(main, "_open_fish_connection", AsyncMock(return_value=new_ws)):
            result = await main.warmup()

        self.assertEqual(result, {"status": "warm"})

    async def test_warmup_returns_error_on_exception(self):
        with patch.object(main, "_open_fish_connection", AsyncMock(side_effect=Exception("Verbindungsfehler"))):
            main._warm["ws"] = None
            result = await main.warmup()

        self.assertEqual(result["status"], "error")
        self.assertEqual("Internal server error", result["message"])


class TestHealthEndpoint(unittest.IsolatedAsyncioTestCase):
    """Tests für den /health-Endpunkt."""

    @patch("main.httpx.AsyncClient")
    async def test_health_success_includes_voice_and_model(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"credit": 100},
        )
        mock_client_class.return_value = mock_client

        with patch("main.AUDIO_REFERENCE_ID", "voice-abc"), \
             patch("main.AUDIO_MODEL", "s2-pro"):
            response = await main.health()

        self.assertEqual(response["status"], "ok")
        self.assertEqual(response["credits"], {"credit": 100})
        self.assertEqual(response["voice"], "voice-abc")
        self.assertEqual(response["model"], "s2-pro")

    @patch("main.httpx.AsyncClient")
    async def test_health_timeout_still_returns_voice_and_model(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")
        mock_client_class.return_value = mock_client

        with patch("main.AUDIO_REFERENCE_ID", "voice-abc"), \
             patch("main.AUDIO_MODEL", "s2-pro"):
            response = await main.health()

        self.assertEqual(response["status"], "unavailable")
        self.assertEqual(response["message"], "Fish Audio API Timeout")
        self.assertEqual(response["voice"], "voice-abc")
        self.assertEqual(response["model"], "s2-pro")

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
