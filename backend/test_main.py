import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from starlette.websockets import WebSocketDisconnect

import main


async def _aiter_bytes(chunks):
    for chunk in chunks:
        yield chunk


class TTSProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_forwards_text_and_streams_audio_chunks(self):
        websocket = AsyncMock()
        websocket.receive_json.side_effect = [{"text": "Hallo"}, WebSocketDisconnect()]

        response = MagicMock()
        response.aiter_bytes = lambda: _aiter_bytes([b"chunk-1", b"chunk-2"])

        stream_cm = AsyncMock()
        stream_cm.__aenter__.return_value = response
        stream_cm.__aexit__.return_value = None

        client = MagicMock()
        client.stream.return_value = stream_cm

        client_cm = AsyncMock()
        client_cm.__aenter__.return_value = client
        client_cm.__aexit__.return_value = None

        with patch("main.httpx.AsyncClient", return_value=client_cm) as async_client:
            with self.assertRaises(WebSocketDisconnect):
                await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        async_client.assert_called_once_with(timeout=None)
        client.stream.assert_called_once_with(
            "POST",
            f"{main.VLLM_URL}/v1/audio/speech",
            json={"model": "qwen3-tts", "input": "Hallo", "voice": "custom"},
        )
        websocket.send_bytes.assert_has_awaits([unittest.mock.call(b"chunk-1"), unittest.mock.call(b"chunk-2")])

    async def test_disconnect_before_message_skips_upstream_request(self):
        websocket = AsyncMock()
        websocket.receive_json.side_effect = WebSocketDisconnect()

        client = MagicMock()
        client_cm = AsyncMock()
        client_cm.__aenter__.return_value = client
        client_cm.__aexit__.return_value = None

        with patch("main.httpx.AsyncClient", return_value=client_cm):
            with self.assertRaises(WebSocketDisconnect):
                await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        client.stream.assert_not_called()
        websocket.send_bytes.assert_not_called()

    async def test_missing_text_field_raises_key_error(self):
        websocket = AsyncMock()
        websocket.receive_json.return_value = {"message": "missing text key"}

        client = MagicMock()
        client_cm = AsyncMock()
        client_cm.__aenter__.return_value = client
        client_cm.__aexit__.return_value = None

        with patch("main.httpx.AsyncClient", return_value=client_cm):
            with self.assertRaises(KeyError):
                await main.tts_proxy(websocket)

        websocket.accept.assert_awaited_once()
        client.stream.assert_not_called()
