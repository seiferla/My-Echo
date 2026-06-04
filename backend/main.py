import os
import base64
import msgpack
import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse

app = FastAPI()

FISH_API_KEY = os.getenv("TTS_API_KEY", "")
WS_URL = "wss://api.fish.audio/v1/tts/live"
AUDIO_MODEL = os.getenv("TTS_MODEL", "s2-pro")
AUDIO_REFERENCE_ID = os.getenv("TTS_VOICE", "")


@app.websocket("/ws/tts")
async def tts_proxy(websocket: WebSocket):
    await websocket.accept()

    try:
        data = await websocket.receive_json()
        text = data.get("text", "").strip()

        headers = {
            "Authorization": f"Bearer {FISH_API_KEY}",
            "model": AUDIO_MODEL,
        }

        if not text:
            await websocket.close(code=1003, reason="Kein Text übergeben")
            return
        async with websockets.connect(WS_URL, additional_headers=headers) as ws:
            # 1. Start-Event: konfiguriert Format, Stimme und Prosodie
            await ws.send(msgpack.packb({
                "event": "start",
                "request": {
                    "text": "",
                    "format": "mp3",
                    "latency": "normal",
                    "reference_id": AUDIO_REFERENCE_ID,
                    "prosody": {
                        "speed": 0.85,
                        "volume": 2,
                    }
                }
            }))

            await ws.send(msgpack.packb({
                "event": "text",
                "text": text,
            }))

            await ws.send(msgpack.packb({"event": "flush"}))
            await ws.send(msgpack.packb({"event": "stop"}))

            async for message in ws:
                msg = msgpack.unpackb(message)
                event = msg.get("event")

                if event == "audio":
                    audio_b64 = base64.b64encode(msg["audio"]).decode()
                    await websocket.send_text(audio_b64)

                elif event == "finish":
                    break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"Error in tts_proxy: {e}")
        try:
            await websocket.send_json({"error": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass

@app.get("/stream/tts")
async def stream_tts(text: str):
    headers = {
        "Authorization": f"Bearer {FISH_API_KEY}",
        "model": AUDIO_MODEL,
    }

    async def generate():
        async with websockets.connect(WS_URL, additional_headers=headers) as ws:
            await ws.send(msgpack.packb({
                "event": "start",
                "request": {
                    "text": "",
                    "format": "mp3",
                    "latency": "normal",
                    "reference_id": AUDIO_REFERENCE_ID,
                    "prosody": {
                        "speed": 0.85,
                        "volume": 2,
                    }
                }
            }))
            await ws.send(msgpack.packb({"event": "text", "text": text}))
            await ws.send(msgpack.packb({"event": "flush"}))
            await ws.send(msgpack.packb({"event": "stop"}))

            async for message in ws:
                msg = msgpack.unpackb(message)
                if msg.get("event") == "audio":
                    yield msg["audio"]
                elif msg.get("event") == "finish":
                    break

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )

@app.get("/health")
async def health():
    url = "https://api.fish.audio/wallet/self/api-credit"
    headers = {"Authorization": f"Bearer {FISH_API_KEY}", "model": AUDIO_MODEL}

    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            return {"status": "ok", "credits": response.json()}
        except httpx.TimeoutException:
            return {"status": "unavailable", "message": "Fish Audio API Timeout"}
        except httpx.HTTPStatusError as e:
            return {"status": "error", "message": f"HTTP {e.response.status_code}"}
        except Exception as e:
            return {"status": "error", "message": str(e)}
