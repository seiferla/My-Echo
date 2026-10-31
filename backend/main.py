import os
import logging
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from prometheus_fastapi_instrumentator import Instrumentator
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

import mistral_tts
from db import init_db, close_db, list_chats, upsert_chat, delete_chat

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("myecho.tts")

# --- Pydantic-Modelle (vor app = FastAPI(...) einfügen) ---------------------

class MessageModel(BaseModel):
    id: str
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=10_000)
    timestamp: Optional[int] = None
    via: Optional[str] = Field(None, pattern="^(send|save)$")
    editCount: int = 0


class ChatModel(BaseModel):
    id: str
    title: str = Field(max_length=200)
    timestamp: int
    pinned: bool = False
    messages: list[MessageModel] = []


# --- Lifespan: DB beim Start initialisieren, beim Stop schließen ------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(lifespan=lifespan)
Instrumentator().instrument(app).expose(app)

# Rate limiting: single-user app, generous limits to prevent API abuse
limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS: allow mobile app (Expo) and local dev origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8081",   # Expo web
        "http://localhost:19006",  # Expo web (alt)
        "exp://*",                 # Expo Go (native)
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/warmup")
async def warmup():
    """Vom Frontend aufgerufen, sobald der User tippt. Mistral ist zustandslos, es gibt nichts vorzuwärmen."""
    return await mistral_tts.warm_up()


@app.get("/stream/tts")
@limiter.limit("30/minute")
async def stream_tts(request: Request, text: str):
    return StreamingResponse(
        mistral_tts.stream(text),
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/health")
async def health():
    base = {"voice": mistral_tts.VOICE, "model": mistral_tts.MODEL, "provider": "mistral"}
    return {**base, **await mistral_tts.check_health()}


# --- Endpoints (am Ende der Datei ergänzen) ---------------------------------

@app.get("/chats", response_model=list[ChatModel])
async def get_chats():
    """Alle Chats laden — wird beim App-Start aufgerufen."""
    return await list_chats()


@app.put("/chats/{chat_id}")
async def put_chat(chat_id: str, chat: ChatModel):
    """Chat anlegen oder komplett ersetzen."""
    if chat.id != chat_id:
        raise HTTPException(400, "chat_id mismatch between URL and body")
    await upsert_chat(chat.model_dump())
    return {"status": "ok"}


@app.delete("/chats/{chat_id}")
async def remove_chat(chat_id: str):
    deleted = await delete_chat(chat_id)
    if not deleted:
        raise HTTPException(404, f"chat {chat_id} not found")
    return {"status": "deleted"}
