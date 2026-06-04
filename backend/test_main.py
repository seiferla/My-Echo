import unittest
import base64
import msgpack
from unittest.mock import AsyncMock, MagicMock, patch

import main


class TestTextToSpeechProxy(unittest.IsolatedAsyncioTestCase):
    async def test_forwards_text_and_streams_audio_chunks(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"text": "Hello"}
        websocket.client_state.name = "CONNECTED"

        # Mock websockets.connect
        mock_ws_connection = AsyncMock()
        mock_ws_connection.send = AsyncMock()
        
        # Mocking the async iterator for the audio stream
        audio_msg = {"event": "audio", "audio": b"audio_chunk"}
        finish_msg = {"event": "finish"}
        mock_ws_connection.__aiter__.return_value = [
            msgpack.packb(audio_msg),
            msgpack.packb(finish_msg)
        ]
        
        # Mocking the async context manager
        mock_connect = MagicMock()
        mock_connect.__aenter__.return_value = mock_ws_connection

        with patch("main.websockets.connect", return_value=mock_connect), \
             patch("main.FISH_API_KEY", "test_key"), \
             patch("main.AUDIO_REFERENCE_ID", "test_ref"):
            
            await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        # verify multiple sends: start, text, flush, stop
        self.assertEqual(mock_ws_connection.send.await_count, 4)
        
        # verify audio chunk was sent back to client
        websocket.send_text.assert_awaited_once()
        sent_audio_b64 = websocket.send_text.call_args[0][0]
        self.assertEqual(sent_audio_b64, base64.b64encode(b"audio_chunk").decode())

    async def test_close_on_empty_text(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"text": ""}
        
        await main.tts_proxy(websocket)
        
        websocket.accept.assert_awaited_once()
        # It is called twice: once in the if not text block, once in finally
        self.assertEqual(websocket.close.await_count, 2)
        websocket.close.assert_any_await(code=1003, reason="Kein Text übergeben")

    async def test_error_handling_closes_websocket(self):
        websocket = AsyncMock()
        websocket.receive_json.side_effect = Exception("Test Error")
        
        await main.tts_proxy(websocket)
        
        # Should send error json
        websocket.send_json.assert_awaited_once_with({"error": "Test Error"})
        # Should be closed in finally
        websocket.close.assert_awaited_once()

class TestHealthEndpoint(unittest.IsolatedAsyncioTestCase):
    @patch("main.httpx.AsyncClient")
    async def test_health_success(self, mock_client_class):
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.return_value = MagicMock(status_code=200, json=lambda: {"credit": 100})
        mock_client_class.return_value = mock_client

        response = await main.health()
        self.assertEqual(response, {"status": "ok", "credits": {"credit": 100}})

    @patch("main.httpx.AsyncClient")
    async def test_health_timeout(self, mock_client_class):
        import httpx
        mock_client = AsyncMock()
        mock_client.__aenter__.return_value = mock_client
        mock_client.get.side_effect = httpx.TimeoutException("Timeout")
        mock_client_class.return_value = mock_client

        response = await main.health()
        self.assertEqual(response, {"status": "unavailable", "message": "Fish Audio API Timeout"})
