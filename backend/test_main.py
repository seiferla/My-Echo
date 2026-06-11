import unittest
import base64
import msgpack
from unittest.mock import AsyncMock, MagicMock, patch, call

import main


class TestTtsProxyWebSocket(unittest.IsolatedAsyncioTestCase):
    """Tests für den Legacy-WebSocket-Endpunkt /ws/tts."""

    async def test_forwards_text_and_streams_audio_chunks(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"text": "Hello"}
        websocket.client_state.name = "CONNECTED"

        mock_ws_connection = AsyncMock()
        mock_ws_connection.send = AsyncMock()
        audio_msg = {"event": "audio", "audio": b"audio_chunk"}
        finish_msg = {"event": "finish"}
        mock_ws_connection.__aiter__.return_value = [
            msgpack.packb(audio_msg),
            msgpack.packb(finish_msg),
        ]

        mock_connect = MagicMock()
        mock_connect.__aenter__.return_value = mock_ws_connection

        with patch("main.websockets.connect", return_value=mock_connect), \
             patch("main.FISH_API_KEY", "test_key"), \
             patch("main.AUDIO_REFERENCE_ID", "test_ref"):
            await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        # start + text + flush + stop
        self.assertEqual(mock_ws_connection.send.await_count, 4)
        websocket.send_text.assert_awaited_once()
        sent = websocket.send_text.call_args[0][0]
        self.assertEqual(sent, base64.b64encode(b"audio_chunk").decode())

    async def test_close_on_empty_text(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"text": ""}

        await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        # once in the "if not text" branch, once in finally
        self.assertEqual(websocket.close.await_count, 2)
        websocket.close.assert_any_await(code=1003, reason="Kein Text übergeben")

    async def test_error_handling_closes_websocket(self):
        websocket = AsyncMock()
        websocket.receive_json.side_effect = Exception("Test Error")

        await main.tts_proxy(websocket)

        websocket.send_json.assert_awaited_once_with({"error": "Test Error"})
        websocket.close.assert_awaited_once()


class TestStreamTts(unittest.IsolatedAsyncioTestCase):
    """Tests für den HTTP-Streaming-Endpunkt /stream/tts."""

    def _make_ws_mock(self, chunks=None):
        """Baut einen WebSocket-Mock der Audio-Chunks + finish liefert."""
        chunks = chunks or [b"chunk1", b"chunk2"]
        mock_ws = AsyncMock()
        messages = [msgpack.packb({"event": "audio", "audio": c}) for c in chunks]
        messages.append(msgpack.packb({"event": "finish"}))
        mock_ws.__aiter__.return_value = messages
        return mock_ws

    async def test_uses_warm_connection_when_available(self):
        warm_ws = self._make_ws_mock()
        warm_ws.closed = False

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=warm_ws)):
            response = await main.stream_tts("Hallo Welt")
            # Generator is lazy — must consume inside the patch context
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")
        # text + flush + stop gesendet (kein start, da warm)
        self.assertEqual(warm_ws.send.await_count, 3)

    async def test_opens_fresh_connection_when_no_warm(self):
        fresh_ws = self._make_ws_mock()
        fresh_ws.closed = False

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=None)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=fresh_ws)):
            response = await main.stream_tts("Test")
            collected = b"".join([c async for c in response.body_iterator])

        self.assertEqual(collected, b"chunk1chunk2")
        # start bereits in _open_fish_connection, dann text + flush + stop
        self.assertEqual(fresh_ws.send.await_count, 3)

    async def test_retries_with_fresh_connection_when_warm_is_dead(self):
        dead_ws = AsyncMock()
        dead_ws.send.side_effect = Exception("Connection closed")
        dead_ws.close = AsyncMock()

        fresh_ws = self._make_ws_mock()

        with patch.object(main, "_take_warm_connection", AsyncMock(return_value=dead_ws)), \
             patch.object(main, "_open_fish_connection", AsyncMock(return_value=fresh_ws)):
            response = await main.stream_tts("Retry test")
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

    async def test_warmup_returns_error_on_exception(self):
        with patch.object(main, "_open_fish_connection", AsyncMock(side_effect=Exception("Verbindungsfehler"))):
            main._warm["ws"] = None
            result = await main.warmup()

        self.assertEqual(result["status"], "error")
        self.assertIn("Verbindungsfehler", result["message"])


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
