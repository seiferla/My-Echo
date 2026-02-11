# backend/main.py
import os
import httpx
from fastapi import FastAPI, WebSocket

app = FastAPI()
VLLM_URL = os.getenv("VLLM_URL", "http://localhost:8000")

@app.websocket("/ws/tts")
async def tts_proxy(websocket: WebSocket):
  await websocket.accept()

  # Nutze einen persistenten HTTP-Client für die Verbindung zu vLLM
  async with httpx.AsyncClient(timeout=None) as client:
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

        async for chunk in response.aiter_bytes():
          await websocket.send_bytes(chunk)
