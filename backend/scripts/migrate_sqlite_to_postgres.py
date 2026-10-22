"""Überträgt die Chats der Einzelnutzer-Version (SQLite auf dem Pi) nach Postgres (Issue #234).

Arbeitet immer auf einer KOPIE von chats.db (die Datei wird nur lesend geöffnet).
Ohne --apply ist es ein Probelauf: alles wird in einer Transaktion geschrieben
und am Ende zurückgerollt. Die Zahlen sind also genau die eines echten Laufs.

    python scripts/migrate_sqlite_to_postgres.py --sqlite chats-copy.db --user-id <uuid>
    python scripts/migrate_sqlite_to_postgres.py --sqlite chats-copy.db --user-id <uuid> --apply

DATABASE_URL kommt aus der Umgebung oder aus --database-url.

Regeln:
- Ein Chat, den es für diesen Nutzer in Postgres schon gibt, bleibt unverändert,
  auch seine Nachrichten. Die App hat ihn dann schon übernommen.
- Zeilen, die die Regeln in Postgres verletzen (role, via, fehlender Chat),
  werden gemeldet und übersprungen, nie still verworfen.
- Es werden nie Nachrichtentexte ausgegeben, nur IDs und Zahlen.
"""
import argparse
import asyncio
import os
import sqlite3
import sys
import uuid
from dataclasses import dataclass, field
from urllib.parse import urlparse

import asyncpg

ROLES = {"user", "assistant"}
VIAS = {None, "send", "save"}


@dataclass
class Report:
    sqlite_chats: int = 0
    sqlite_messages: int = 0
    rejected: list[str] = field(default_factory=list)
    chats_inserted: int = 0
    chats_already_present: list[str] = field(default_factory=list)
    messages_inserted: int = 0
    postgres_chats: int = 0
    postgres_messages: int = 0
    mismatches: list[str] = field(default_factory=list)
    applied: bool = False


def read_sqlite(path: str) -> tuple[list[dict], list[dict]]:
    """Liest Chats und Nachrichten nur lesend aus der SQLite-Datei."""
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        chats = [dict(r) for r in conn.execute(
            "SELECT id, title, timestamp, pinned, updated_at FROM chats ORDER BY id"
        )]
        messages = [dict(r) for r in conn.execute(
            "SELECT id, chat_id, seq, role, content, timestamp, via, edit_count "
            "FROM messages ORDER BY chat_id, seq"
        )]
    finally:
        conn.close()
    return chats, messages


def validate(chats: list[dict], messages: list[dict]) -> tuple[list[dict], list[str]]:
    """Gibt die gültigen Nachrichten zurück und eine Liste der übersprungenen."""
    chat_ids = {c["id"] for c in chats}
    good, rejected = [], []
    for m in messages:
        if m["chat_id"] not in chat_ids:
            problem = f"chat {m['chat_id']!r} does not exist"
        elif m["role"] not in ROLES:
            problem = f"role {m['role']!r} is not allowed"
        elif m["via"] not in VIAS:
            problem = f"via {m['via']!r} is not allowed"
        else:
            good.append(m)
            continue
        rejected.append(f"message {m['id']!r}: {problem}")
    return good, rejected


async def migrate(database_url: str, user_id: str, chats: list[dict],
                  messages: list[dict], apply: bool) -> Report:
    report = Report(sqlite_chats=len(chats), sqlite_messages=len(messages))
    messages, report.rejected = validate(chats, messages)

    conn = await asyncpg.connect(database_url)
    try:
        if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM auth.users WHERE id = $1)", user_id):
            raise SystemExit(f"User {user_id} does not exist in auth.users. Create the account first.")

        tx = conn.transaction()
        await tx.start()
        try:
            inserted_chats = set()
            for c in chats:
                new_id = await conn.fetchval(
                    """INSERT INTO chats (user_id, id, title, timestamp, pinned, updated_at)
                       VALUES ($1, $2, $3, $4, $5, $6)
                       ON CONFLICT (user_id, id) DO NOTHING RETURNING id""",
                    user_id, c["id"], c["title"], c["timestamp"], bool(c["pinned"]), c["updated_at"],
                )
                if new_id is None:
                    report.chats_already_present.append(c["id"])
                else:
                    inserted_chats.add(c["id"])
            report.chats_inserted = len(inserted_chats)

            # Nachrichten nur für neu angelegte Chats, damit kein fremder Verlauf gemischt wird.
            for m in messages:
                if m["chat_id"] not in inserted_chats:
                    continue
                await conn.execute(
                    """INSERT INTO messages
                           (user_id, id, chat_id, seq, role, content, timestamp, via, edit_count)
                       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)""",
                    user_id, m["id"], m["chat_id"], m["seq"], m["role"], m["content"],
                    m["timestamp"], m["via"], m["edit_count"],
                )
                report.messages_inserted += 1

            # Kontrolle: jeder neu angelegte Chat hat in Postgres so viele Nachrichten wie in SQLite.
            for chat_id in sorted(inserted_chats):
                expected = sum(1 for m in messages if m["chat_id"] == chat_id)
                actual = await conn.fetchval(
                    "SELECT count(*) FROM messages WHERE user_id = $1 AND chat_id = $2", user_id, chat_id
                )
                if actual != expected:
                    report.mismatches.append(f"chat {chat_id!r}: {actual} in Postgres, {expected} in SQLite")

            report.postgres_chats = await conn.fetchval(
                "SELECT count(*) FROM chats WHERE user_id = $1", user_id)
            report.postgres_messages = await conn.fetchval(
                "SELECT count(*) FROM messages WHERE user_id = $1", user_id)

            if apply and not report.mismatches:
                await tx.commit()
                report.applied = True
            else:
                await tx.rollback()
        except BaseException:
            await tx.rollback()
            raise
    finally:
        await conn.close()
    return report


def print_report(report: Report, target: str) -> None:
    mode = "APPLIED" if report.applied else "DRY RUN (nothing written)"
    print(f"Target: {target}  |  {mode}")
    print(f"SQLite:   {report.sqlite_chats} chats, {report.sqlite_messages} messages")
    print(f"Inserted: {report.chats_inserted} chats, {report.messages_inserted} messages")
    if report.chats_already_present:
        print(f"Already in Postgres, left unchanged: {len(report.chats_already_present)} chats "
              f"({', '.join(report.chats_already_present)})")
    print(f"Postgres for this user: {report.postgres_chats} chats, {report.postgres_messages} messages")
    for line in report.rejected:
        print(f"SKIPPED {line}")
    for line in report.mismatches:
        print(f"MISMATCH {line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Copy single-user chats from SQLite to Postgres (issue #234).")
    parser.add_argument("--sqlite", required=True, help="path to a COPY of chats.db")
    parser.add_argument("--user-id", required=True, help="Supabase user id (uuid) that gets the chats")
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"), help="default: $DATABASE_URL")
    parser.add_argument("--apply", action="store_true", help="really write (default: dry run)")
    args = parser.parse_args(argv)

    if not args.database_url:
        parser.error("DATABASE_URL is missing")
    try:
        user_id = str(uuid.UUID(args.user_id))
    except ValueError:
        parser.error("--user-id must be a uuid")
    if not os.path.isfile(args.sqlite):
        parser.error(f"file not found: {args.sqlite}")

    chats, messages = read_sqlite(args.sqlite)
    report = asyncio.run(migrate(args.database_url, user_id, chats, messages, args.apply))
    target = urlparse(args.database_url).hostname or "?"
    print_report(report, target)
    return 1 if report.mismatches else 0


if __name__ == "__main__":
    sys.exit(main())
