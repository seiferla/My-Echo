# backend/main.py
import os
import httpx
from fastapi import FastAPI, WebSocket
from fastapi.websockets import WebSocketDisconnect

app = FastAPI()
VLLM_URL = os.getenv("VLLM_URL", "http://localhost:8000")

@app.websocket("/ws/tts")
async def tts_proxy(websocket: WebSocket):
  await websocket.accept()

  # Nutze einen persistenten HTTP-Client für die Verbindung zu vLLM
  async with httpx.AsyncClient(timeout=None) as client:
    try:
      while True:
        data = await websocket.receive_json()

        async with client.stream(
            "POST",
            f"{VLLM_URL}/v1/audio/speech",
            json={
              "model": "qwen3-tts",
              "input": data["text"],
              "voice": "custom"
            }
        ) as response:
          response.raise_for_status()
          async for chunk in response.aiter_bytes():
            await websocket.send_bytes(chunk)

    except WebSocketDisconnect:
      pass
    except Exception as e:
      print(f"Error in tts_proxy: {e}")
      await websocket.close(code=1011)
