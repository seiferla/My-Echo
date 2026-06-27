"""SQLite-Persistenz für Chats und Messages.

Single-User-Setup auf einem Raspberry Pi. Eine .db-Datei im Backend-Prozess,
kein ORM, kein Migration-Framework. Schema-Änderungen via CREATE TABLE IF
NOT EXISTS + manuellem ALTER TABLE wenn nötig.
"""
import os
import json
import time
from contextlib import asynccontextmanager
from typing import Any

import aiosqlite

DB_PATH = os.getenv("DB_PATH", "/data/chats.db")

SCHEMA = """
         CREATE TABLE IF NOT EXISTS chats (
                                              id          TEXT PRIMARY KEY,
                                              title       TEXT NOT NULL,
                                              timestamp   INTEGER NOT NULL,
                                              pinned      INTEGER NOT NULL DEFAULT 0,
                                              updated_at  INTEGER NOT NULL
         );

         CREATE TABLE IF NOT EXISTS messages (
                                                 id          TEXT PRIMARY KEY,
                                                 chat_id     TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
             seq         INTEGER NOT NULL,
             role        TEXT NOT NULL,
             content     TEXT NOT NULL,
             timestamp   INTEGER,
             via         TEXT,
             edit_count  INTEGER NOT NULL DEFAULT 0
             );

         CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, seq); \
         """


_db: aiosqlite.Connection | None = None


async def init_db() -> aiosqlite.Connection:
    """Beim App-Start aus dem lifespan aufrufen."""
    global _db
    # WAL-Modus für bessere Concurrency (mehrere Leser, ein Schreiber gleichzeitig)
    _db = await aiosqlite.connect(DB_PATH)
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.execute("PRAGMA foreign_keys=ON")
    await _db.executescript(SCHEMA)
    await _db.commit()
    return _db


async def close_db() -> None:
    global _db
    if _db is not None:
        await _db.close()
        _db = None


def db() -> aiosqlite.Connection:
    if _db is None:
        raise RuntimeError("Database not initialized — call init_db() first")
    return _db


# --- Public API -------------------------------------------------------------

async def list_chats() -> list[dict[str, Any]]:
    """Alle Chats inkl. Messages, neueste zuerst."""
    conn = db()
    async with conn.execute(
            "SELECT id, title, timestamp, pinned FROM chats "
            "ORDER BY pinned DESC, timestamp DESC"
    ) as cur:
        chat_rows = await cur.fetchall()

    if not chat_rows:
        return []

    chat_ids = [r["id"] for r in chat_rows]
    placeholders = ",".join("?" * len(chat_ids))
    async with conn.execute(
            f"SELECT id, chat_id, role, content, timestamp, via, edit_count "
            f"FROM messages WHERE chat_id IN ({placeholders}) ORDER BY chat_id, seq",
            chat_ids,
    ) as cur:
        msg_rows = await cur.fetchall()

    messages_by_chat: dict[str, list[dict]] = {cid: [] for cid in chat_ids}
    for r in msg_rows:
        messages_by_chat[r["chat_id"]].append({
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
            "pinned": bool(r["pinned"]),
            "messages": messages_by_chat.get(r["id"], []),
        }
        for r in chat_rows
    ]


async def upsert_chat(chat: dict[str, Any]) -> None:
    """Chat komplett ersetzen (inkl. Messages). Idempotent."""
    conn = db()
    now = int(time.time() * 1000)
    async with conn.execute("BEGIN"):
        await conn.execute(
            """INSERT INTO chats(id, title, timestamp, pinned, updated_at)
               VALUES(?, ?, ?, ?, ?)
                   ON CONFLICT(id) DO UPDATE SET
                title=excluded.title,
                                          timestamp=excluded.timestamp,
                                          pinned=excluded.pinned,
                                          updated_at=excluded.updated_at""",
            (chat["id"], chat["title"], chat["timestamp"],
             1 if chat.get("pinned") else 0, now),
        )
        # Messages komplett austauschen — einfacher als Diff
        await conn.execute("DELETE FROM messages WHERE chat_id=?", (chat["id"],))
        for seq, m in enumerate(chat.get("messages", [])):
            await conn.execute(
                """INSERT INTO messages
                       (id, chat_id, seq, role, content, timestamp, via, edit_count)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)""",
                (m["id"], chat["id"], seq, m["role"], m["content"],
                 m.get("timestamp"), m.get("via"), m.get("editCount", 0)),
            )
    await conn.commit()


async def delete_chat(chat_id: str) -> bool:
    conn = db()
    async with conn.execute(
            "DELETE FROM chats WHERE id=?", (chat_id,)
    ) as cur:
        deleted = cur.rowcount > 0
    await conn.commit()
    return deleted