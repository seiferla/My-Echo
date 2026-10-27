"""Tests for scripts/migrate_sqlite_to_postgres.py against the local test Postgres."""
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

from testutils import TEST_DB, USER_A, clear_user_data, prepare_schema, with_test_db

_spec = importlib.util.spec_from_file_location(
    "migrate_sqlite_to_postgres",
    pathlib.Path(__file__).parent / "scripts" / "migrate_sqlite_to_postgres.py",
)
mig = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mig)

# Schema of the single-user version (backend/db.py on main).
OLD_SCHEMA = """
CREATE TABLE chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, timestamp INTEGER NOT NULL,
                    pinned INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE messages (id TEXT PRIMARY KEY, chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                       seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL,
                       timestamp INTEGER, via TEXT, edit_count INTEGER NOT NULL DEFAULT 0);
"""
SECRET = "Text-that-is-never-printed"


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
        ("bad-role", "a", 2, "system", "from an old version", 4, "send", 0),
    ])
    # Orphan message. SQLite checks foreign keys only with a PRAGMA, so this insert works.
    conn.execute("INSERT INTO messages VALUES ('orphan', 'gone', 0, 'user', 'x', 5, 'send', 0)")
    conn.commit()
    conn.close()


def _count(sql, *args):
    return with_test_db(lambda conn: conn.fetchval(sql, *args))


class TestMigration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        prepare_schema()

    def setUp(self):
        clear_user_data()
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
        with_test_db(lambda conn: conn.execute(
            "INSERT INTO chats (user_id, id, title, timestamp, pinned, updated_at) "
            "VALUES ($1, 'a', 'New title from the app', 1, false, 99)", USER_A))

        report = self._run(apply=True)
        self.assertEqual(report.chats_already_present, ["a"])
        self.assertEqual(
            _count("SELECT title FROM chats WHERE user_id = $1 AND id = 'a'", USER_A),
            "New title from the app",
        )
        # No old messages mixed into the app's chat; chat b is new.
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1 AND chat_id = 'a'", USER_A), 0)
        self.assertEqual(_count("SELECT count(*) FROM messages WHERE user_id = $1 AND chat_id = 'b'", USER_A), 1)

    def test_unknown_user_is_refused(self):
        with self.assertRaises(mig.UnknownUserError):
            self._run(apply=True, user_id=str(uuid.uuid4()))

    def test_cli_returns_an_error_code_for_an_unknown_user(self):
        with contextlib.redirect_stderr(io.StringIO()):
            code = mig.main(["--sqlite", self.sqlite, "--user-id", str(uuid.uuid4()),
                             "--database-url", TEST_DB, "--apply"])
        self.assertEqual(code, 2)

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
