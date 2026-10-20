"""Postgres-Persistenz für Chats und Messages (Supabase).

Das Schema kommt aus den Migrationen unter supabase/migrations/ und wird hier
NICHT angelegt. Jede Funktion bekommt die user_id als Parameter. Sie kommt aus
dem geprüften Token (auth.py) und filtert jede Abfrage danach.

Hinweis: Das Backend verbindet sich als Datenbank-Owner und umgeht damit RLS.
Die Isolation hängt deshalb am WHERE user_id = ... in jeder Abfrage.
"""
import os
import time
from typing import Any, Optional

import asyncpg

_pool: Optional[asyncpg.Pool] = None


async def init_db() -> asyncpg.Pool:
    """Beim App-Start aus dem lifespan aufrufen."""
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


# --- Public API -------------------------------------------------------------

async def list_chats(user_id: str) -> list[dict[str, Any]]:
    """Alle Chats dieses Nutzers inkl. Messages, neueste zuerst."""
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
    """Chat dieses Nutzers komplett ersetzen (inkl. Messages). Idempotent.

    Der Primary Key ist (user_id, id). Eine gleiche Chat-ID bei einem anderen
    Nutzer ist daher ein eigener Chat und überschreibt nichts.
    """
    now = int(time.time() * 1000)
    async with pool().acquire() as conn:
        async with conn.transaction():
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
            # Messages komplett austauschen — einfacher als Diff
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
    """Löscht nur einen Chat dieses Nutzers. Fremde Chats bleiben unberührt."""
    async with pool().acquire() as conn:
        result = await conn.execute(
            "DELETE FROM chats WHERE user_id = $1 AND id = $2", user_id, chat_id
        )
    return result == "DELETE 1"
