"""Request and response models of the API."""
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

MAX_MESSAGE_CHARS = 10_000
MAX_STAT_DAYS = 800

# Same day format as in the app.
DayKey = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class MessageModel(BaseModel):
    id: str
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    timestamp: int | None = None
    via: str | None = Field(None, pattern="^(send|save)$")
    editCount: int = 0


class ChatModel(BaseModel):
    id: str
    title: str = Field(max_length=200)
    timestamp: int
    pinned: bool = False
    messages: list[MessageModel] = []


class PhraseModel(BaseModel):
    id: str = Field(max_length=100)
    text: str = Field(min_length=1, max_length=1000)
    useCount: int = Field(0, ge=0, le=1_000_000_000)
    lastUsedAt: int | None = None
    createdAt: int


class PhraseSettingsModel(BaseModel):
    visibleCount: int = Field(ge=0, le=20)
    instantEnabled: bool


class PhraseStoreModel(BaseModel):
    phrases: list[PhraseModel] = Field(default=[], max_length=200)
    settings: PhraseSettingsModel
    updatedAt: int = Field(ge=0)  # ms; the newer store wins


class TtsDayStatModel(BaseModel):
    requests: int = Field(ge=0, le=1_000_000_000)
    chars: int = Field(ge=0, le=1_000_000_000)
    durationMs: int = Field(ge=0, le=10**12)


class VoiceModel(BaseModel):
    voiceId: str
    name: str
    createdAt: int
    consentedAt: int
