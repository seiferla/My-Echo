import unittest
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
        
        # Mocking the async context manager
        mock_connect = MagicMock()
        mock_connect.__aenter__.return_value = mock_ws_connection

        with patch("main.websockets.connect", return_value=mock_connect), \
             patch("main.msgpack.packb", return_value=b"packed_data") as mock_packb:
            
            await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        mock_packb.assert_called()
        mock_ws_connection.send.assert_awaited_once_with(b"packed_data")

    async def test_close_on_empty_text(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"text": ""}
        
        await main.tts_proxy(websocket)
        
        websocket.accept.assert_awaited_once()
        websocket.close.assert_awaited_once_with(code=1003, reason="Kein Text übergeben")

    async def test_error_handling_closes_websocket(self):
        websocket = AsyncMock()
        websocket.receive_json.side_effect = Exception("Test Error")
        websocket.client_state.name = "CONNECTED"
        
        await main.tts_proxy(websocket)
        
        websocket.close.assert_awaited_once_with(code=1011, reason="Test Error")

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
