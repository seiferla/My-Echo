"""Postgres access (Supabase). The schema lives in supabase/migrations/.

The backend connects as the database owner and so bypasses RLS. Data isolation
depends on the "WHERE user_id = ..." in EVERY query below.
"""
import json
import os
import time
from typing import Any

import asyncpg

_pool: asyncpg.Pool | None = None


async def init_db() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(
        os.environ["DATABASE_URL"],
        min_size=1,
        max_size=int(os.getenv("DB_POOL_MAX", "5")),
    )
    return _pool


async def close_db() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _pool


async def list_chats(user_id: str) -> list[dict[str, Any]]:
    """All chats of the user with their messages; pinned first, then newest first."""
    async with pool().acquire() as conn:
        chat_rows = await conn.fetch(
            "SELECT id, title, timestamp, pinned FROM chats "
            "WHERE user_id = $1 ORDER BY pinned DESC, timestamp DESC",
            user_id,
        )
        msg_rows = await conn.fetch(
            "SELECT id, chat_id, role, content, timestamp, via, edit_count "
            "FROM messages WHERE user_id = $1 ORDER BY chat_id, seq",
            user_id,
        )

    messages_by_chat: dict[str, list[dict]] = {r["id"]: [] for r in chat_rows}
    for r in msg_rows:
        messages_by_chat.setdefault(r["chat_id"], []).append({
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "timestamp": r["timestamp"],
            "via": r["via"],
            "editCount": r["edit_count"],
        })

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "timestamp": r["timestamp"],
            "pinned": r["pinned"],
            "messages": messages_by_chat.get(r["id"], []),
        }
        for r in chat_rows
    ]


async def upsert_chat(user_id: str, chat: dict[str, Any]) -> None:
    """Creates or fully replaces a chat with its messages. Idempotent.

    The primary key is (user_id, id), so the same chat id of another user is a different chat.
    """
    now = int(time.time() * 1000)
    async with pool().acquire() as conn, conn.transaction():
        await conn.execute(
            """INSERT INTO chats (user_id, id, title, timestamp, pinned, updated_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (user_id, id) DO UPDATE SET
                   title = EXCLUDED.title,
                   timestamp = EXCLUDED.timestamp,
                   pinned = EXCLUDED.pinned,
                   updated_at = EXCLUDED.updated_at""",
            user_id, chat["id"], chat["title"], chat["timestamp"],
            bool(chat.get("pinned")), now,
        )
        # Replace all messages: simpler than a diff.
        await conn.execute(
            "DELETE FROM messages WHERE user_id = $1 AND chat_id = $2",
            user_id, chat["id"],
        )
        await conn.executemany(
            """INSERT INTO messages
                   (user_id, id, chat_id, seq, role, content, timestamp, via, edit_count)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
            [
                (user_id, m["id"], chat["id"], seq, m["role"], m["content"],
                 m.get("timestamp"), m.get("via"), m.get("editCount", 0))
                for seq, m in enumerate(chat.get("messages", []))
            ],
        )


async def delete_chat(user_id: str, chat_id: str) -> bool:
    async with pool().acquire() as conn:
        result = await conn.execute(
            "DELETE FROM chats WHERE user_id = $1 AND id = $2", user_id, chat_id
        )
    return result == "DELETE 1"


# --- Phrases -------------------------------------------------------------------

async def get_phrase_store(user_id: str) -> dict[str, Any] | None:
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT data, updated_at FROM phrase_stores WHERE user_id = $1", user_id
        )
    if row is None:
        return None
    data = json.loads(row["data"])
    return {**data, "updatedAt": row["updated_at"]}


async def put_phrase_store(user_id: str, store: dict[str, Any]) -> bool:
    """Saves the store only if it is not older than the saved one. Returns False if it was older.

    So a late request (e.g. after a short network outage) cannot overwrite newer data.
    """
    data = json.dumps({"phrases": store["phrases"], "settings": store["settings"]})
    async with pool().acquire() as conn:
        saved = await conn.fetchval(
            """INSERT INTO phrase_stores (user_id, data, updated_at)
               VALUES ($1, $2::jsonb, $3)
               ON CONFLICT (user_id) DO UPDATE SET
                   data = EXCLUDED.data,
                   updated_at = EXCLUDED.updated_at
               WHERE phrase_stores.updated_at <= EXCLUDED.updated_at
               RETURNING true""",
            user_id, data, store["updatedAt"],
        )
    return saved is not None


# --- TTS statistics ------------------------------------------------------------

async def get_tts_stats(user_id: str) -> dict[str, dict[str, int]]:
    """Returns {"2026-10-19": {"requests": ..., "chars": ..., "durationMs": ...}, ...}."""
    async with pool().acquire() as conn:
        rows = await conn.fetch(
            "SELECT day, requests, chars, duration_ms FROM tts_daily_stats WHERE user_id = $1",
            user_id,
        )
    return {
        r["day"]: {"requests": r["requests"], "chars": r["chars"], "durationMs": r["duration_ms"]}
        for r in rows
    }


async def merge_tts_stats(user_id: str, stats: dict[str, dict[str, int]]) -> None:
    """Per field the larger value wins, so a second device with older numbers does no harm."""
    async with pool().acquire() as conn:
        await conn.executemany(
            """INSERT INTO tts_daily_stats (user_id, day, requests, chars, duration_ms)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (user_id, day) DO UPDATE SET
                   requests = GREATEST(tts_daily_stats.requests, EXCLUDED.requests),
                   chars = GREATEST(tts_daily_stats.chars, EXCLUDED.chars),
                   duration_ms = GREATEST(tts_daily_stats.duration_ms, EXCLUDED.duration_ms)""",
            [
                (user_id, day, s["requests"], s["chars"], s["durationMs"])
                for day, s in stats.items()
            ],
        )


# --- Voice clone (G3) -----------------------------------------------------------

async def get_user_voice(user_id: str) -> dict[str, Any] | None:
    """The user's cloned voice, or None when they have not uploaded one yet."""
    async with pool().acquire() as conn:
        row = await conn.fetchrow(
            "SELECT voice_id, name, created_at, consented_at FROM user_voices WHERE user_id = $1",
            user_id,
        )
    if row is None:
        return None
    return {
        "voiceId": row["voice_id"],
        "name": row["name"],
        "createdAt": row["created_at"],
        "consentedAt": row["consented_at"],
    }


async def set_user_voice(user_id: str, voice_id: str, name: str, consented_at: int) -> None:
    """Stores the voice id for the user. Replaces an existing one (one voice per user)."""
    now = int(time.time() * 1000)
    async with pool().acquire() as conn:
        await conn.execute(
            """INSERT INTO user_voices (user_id, voice_id, name, created_at, consented_at)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (user_id) DO UPDATE SET
                   voice_id = EXCLUDED.voice_id,
                   name = EXCLUDED.name,
                   created_at = EXCLUDED.created_at,
                   consented_at = EXCLUDED.consented_at""",
            user_id, voice_id, name, now, consented_at,
        )


async def delete_user_voice(user_id: str) -> bool:
    """Removes the user's stored voice id. Returns False when there was none."""
    async with pool().acquire() as conn:
        result = await conn.execute("DELETE FROM user_voices WHERE user_id = $1", user_id)
    return result == "DELETE 1"
