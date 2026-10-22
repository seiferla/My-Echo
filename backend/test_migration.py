"""Tests für scripts/migrate_sqlite_to_postgres.py (Issue #234).

Baut eine SQLite-Datei mit dem Schema der Einzelnutzer-Version (main) und
überträgt sie in die Test-Postgres (wie test_chats.py, nur gegen localhost).
"""
import asyncio
import contextlib
import hashlib
import importlib.util
import io
import os
import pathlib
import sqlite3
import tempfile
import unittest
import uuid

import asyncpg

from test_chats import TEST_DB, USER_A, _clear_chats, _prepare_schema

_spec = importlib.util.spec_from_file_location(
    "migrate_sqlite_to_postgres",
    pathlib.Path(__file__).parent / "scripts" / "migrate_sqlite_to_postgres.py",
)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

# Schema der Einzelnutzer-Version, wie in backend/db.py auf main.
OLD_SCHEMA = """
CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, timestamp INTEGER NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                       seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
                       timestamp INTEGER, via TEXT, edit_count INTEGER NOT NULL DEFAULT 0);
"""
SECRET = "Text-der-nie-im-Log-steht"


def _make_sqlite(path):
    conn = sqlite3.connect(path)
    conn.executescript(OLD_SCHEMA)
    conn.executemany("INSERT INTO chats VALUES (?, ?, ?, ?, ?)", [
        ("a", "Chat A", 1_700_000_000_000, 0, 1),
        ("b", "Chat B", 1_700_000_100_000, 1, 2),
    ])
    conn.executemany("INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [
        ("a1", "a", 0, "user", f"Hallo {SECRET}", 1, "send", 0),
        ("a2", "a", 1, "user", "Wie geht's?", 2, "save", 1),
        ("b1", "b", 0, "user", "Danke", 3, None, 0),
        ("bad-role", "a", 2, "system", "von einer alten Version", 4, "send", 0),
    ])
    # Verwaiste Nachricht (Chat fehlt). SQLite prüft Fremdschlüssel nur mit PRAGMA, also geht das.
    conn.execute("INSERT INTO messages VALUES ('orphan', 'gone', 0, 'user', 'x', 5, 'send', 0)")
    conn.commit()
    conn.close()


def _count(sql, *args):
    async def run():
        conn = await asyncpg.connect(TEST_DB)
        try:
            return await conn.fetchval(sql, *args)
        finally:
            await conn.close()
    return asyncio.run(run())


class TestMigration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        asyncio.run(_prepare_schema())

    def setUp(self):
        asyncio.run(_clear_chats())
        self.tmp = tempfile.TemporaryDirectory()
        self.sqlite = os.path.join(self.tmp.name, "chats-copy.db")
        _make_sqlite(self.sqlite)

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, apply, user_id=USER_A):
        chats, messages = mig.read_sqlite(self.sqlite)
        return asyncio.run(mig.migrate(TEST_DB, user_id, chats, messages, apply))

    def test_dry_run_writes_nothing_but_reports_real_numbers(self):
        report = self._run(apply=False)
        self.assertFalse(report.applied)
        self.assertEqual((report.chats_inserted, report.messages_inserted), (2, 3))
        self.assertEqual((report.postgres_chats, report.postgres_messages), (2, 3))
        self.assertEqual(_count("SELECT count(*) FROM chats WHERE user_id = $1", USER_A), 0)

    def test_apply_copies_valid_rows_and_counts_match(self):
        report = self._run(apply=True)
        self.assertTrue(report.applied)
        self.assertEqual(report.mismatches, [])
        self.assertEqual(_count("SELECT count(*) FROM chats WHERE user_id = $1", USER_A), 2)
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1", USER_A), 3)
        self.assertTrue(_count("SELECT pinned FROM chats WHERE user_id = $1 AND id = 'b'", USER_A))

    def test_invalid_rows_are_listed_not_silently_dropped(self):
        report = self._run(apply=True)
        self.assertEqual(len(report.rejected), 2)
        self.assertTrue(any("bad-role" in r and "role" in r for r in report.rejected))
        self.assertTrue(any("orphan" in r and "does not exist" in r for r in report.rejected))

    def test_second_run_changes_nothing(self):
        self._run(apply=True)
        second = self._run(apply=True)
        self.assertEqual((second.chats_inserted, second.messages_inserted), (0, 0))
        self.assertEqual(sorted(second.chats_already_present), ["a", "b"])
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1", USER_A), 3)

    def test_chat_already_synced_by_the_app_is_left_unchanged(self):
        async def app_already_synced_chat_a():
            conn = await asyncpg.connect(TEST_DB)
            try:
                await conn.execute(
                    "INSERT INTO chats (user_id, id, title, timestamp, pinned, updated_at) "
                    "VALUES ($1, 'a', 'Neuer Titel aus der App', 1, false, 99)", USER_A)
            finally:
                await conn.close()
        asyncio.run(app_already_synced_chat_a())

        report = self._run(apply=True)
        self.assertEqual(report.chats_already_present, ["a"])
        self.assertEqual(
            _count("SELECT title FROM chats WHERE user_id = $1 AND id = 'a'", USER_A),
            "Neuer Titel aus der App",
        )
        # Keine alten Nachrichten in den Chat der App gemischt, Chat b kam neu dazu.
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1 AND chat_id = 'a'", USER_A), 0)
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1 AND chat_id = 'b'", USER_A), 1)

    def test_unknown_user_is_refused(self):
        with self.assertRaises(SystemExit):
            self._run(apply=True, user_id=str(uuid.uuid4()))

    def test_output_never_contains_message_text(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = mig.main(["--sqlite", self.sqlite, "--user-id", USER_A,
                             "--database-url", TEST_DB, "--apply"])
        self.assertEqual(code, 0)
        self.assertIn("APPLIED", out.getvalue())
        self.assertNotIn(SECRET, out.getvalue())

    def test_sqlite_file_is_not_changed(self):
        before = hashlib.sha256(pathlib.Path(self.sqlite).read_bytes()).hexdigest()
        self._run(apply=True)
        after = hashlib.sha256(pathlib.Path(self.sqlite).read_bytes()).hexdigest()
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main()
