import os
import time
import asyncio
import base64
import msgpack
import httpx
import websockets
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from prometheus_fastapi_instrumentator import Instrumentator

app = FastAPI()
Instrumentator().instrument(app).expose(app)

FISH_API_KEY = os.getenv("TTS_API_KEY", "")
WS_URL = "wss://api.fish.audio/v1/tts/live"
AUDIO_MODEL = os.getenv("TTS_MODEL", "s2-pro")
AUDIO_REFERENCE_ID = os.getenv("TTS_VOICE", "")

# --- Pre-Warming State -------------------------------------------------------
_warm = {"ws": None, "ts": 0.0}
_warm_lock = asyncio.Lock()
WARM_TTL_SECONDS = 25.0


def _fish_headers() -> dict:
    return {
        "Authorization": f"Bearer {FISH_API_KEY}",
        "model": AUDIO_MODEL,
    }


def _start_payload() -> bytes:
    return msgpack.packb({
        "event": "start",
        "request": {
            "text": "",
            "format": "mp3",
            "latency": "normal",
            "reference_id": AUDIO_REFERENCE_ID,
            "prosody": {
                "speed": 0.85,
                "volume": 0,
            }
        }
    })


async def _open_fish_connection():
    """Öffnet eine Fish-Audio-Verbindung und sendet das start-Event."""
    ws = await websockets.connect(WS_URL, additional_headers=_fish_headers())
    await ws.send(_start_payload())
    return ws


async def _take_warm_connection():
    """
    Gibt eine vorgewärmte Verbindung zurück (und entfernt sie aus dem State),
    falls eine frische genug existiert. Sonst None.
    """
    async with _warm_lock:
        ws = _warm["ws"]
        age = time.monotonic() - _warm["ts"]
        _warm["ws"] = None
        if ws is not None and age < WARM_TTL_SECONDS:
            return ws
        # zu alt: aufräumen
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass
        return None


@app.get("/warmup")
async def warmup():
    """
    Öffnet vorab eine Fish-Audio-Verbindung und sendet das start-Event.
    Vom Frontend aufgerufen sobald der User das Eingabefeld öffnet —
    spart beim späteren Senden den Handshake + start-Roundtrip.
    """
    async with _warm_lock:
        # bestehende warme Verbindung schließen falls vorhanden
        if _warm["ws"] is not None:
            try:
                await _warm["ws"].close()
            except Exception:
                pass
            _warm["ws"] = None
        try:
            _warm["ws"] = await _open_fish_connection()
            _warm["ts"] = time.monotonic()
            return {"status": "warm"}
        except Exception as e:
            return {"status": "error", "message": str(e)}


@app.get("/stream/tts")
async def stream_tts(text: str):
    async def generate():
        # 1. Vorgewärmte Verbindung nutzen, sonst frisch öffnen
        ws = await _take_warm_connection()
        opened_fresh = False
        if ws is None:
            ws = await _open_fish_connection()
            opened_fresh = True

        try:
            # 2. Text senden (start ist bereits gesendet — warm oder fresh)
            try:
                await ws.send(msgpack.packb({"event": "text", "text": text}))
                await ws.send(msgpack.packb({"event": "flush"}))
                await ws.send(msgpack.packb({"event": "stop"}))
            except Exception:
                # Warme Verbindung war doch tot → einmal frisch neu versuchen
                if not opened_fresh:
                    try:
                        await ws.close()
                    except Exception:
                        pass
                    ws = await _open_fish_connection()
                    await ws.send(msgpack.packb({"event": "text", "text": text}))
                    await ws.send(msgpack.packb({"event": "flush"}))
                    await ws.send(msgpack.packb({"event": "stop"}))
                else:
                    raise

            # 3. Audio-Chunks streamen
            async for message in ws:
                msg = msgpack.unpackb(message)
                if msg.get("event") == "audio":
                    yield msg["audio"]
                elif msg.get("event") == "finish":
                    break
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    return StreamingResponse(
        generate(),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.websocket("/ws/tts")
async def tts_proxy(websocket: WebSocket):
    await websocket.accept()

    try:
        data = await websocket.receive_json()
        text = data.get("text", "").strip()

        if not text:
            await websocket.close(code=1003, reason="Kein Text übergeben")
            return

        async with websockets.connect(WS_URL, additional_headers=_fish_headers()) as ws:
            await ws.send(_start_payload())
            await ws.send(msgpack.packb({"event": "text", "text": text}))
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
