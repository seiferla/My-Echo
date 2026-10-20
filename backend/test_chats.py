"""Integration-Tests für die Chat-Endpoints gegen Postgres.

Brauchen eine laufende Postgres. Lokal: der Supabase-Stack (`npx supabase start`),
in CI ein Postgres-Container. Adresse über TEST_DATABASE_URL.
Das Schema kommt aus den echten Migrationen unter supabase/migrations/.
"""
import asyncio
import os
import pathlib
import unittest

import asyncpg
from fastapi.testclient import TestClient

TEST_DB = os.getenv(
    "TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
)
os.environ["DATABASE_URL"] = TEST_DB

import main  # noqa: E402
from auth import current_user  # noqa: E402

MIGRATIONS = sorted(
    (pathlib.Path(__file__).parent.parent / "supabase" / "migrations").glob("*.sql")
)
USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


async def _prepare_schema():
    # Die Tests löschen Tabellen. Nur gegen eine lokale Datenbank erlauben,
    # damit niemals das echte Supabase-Projekt getroffen wird.
    if not any(host in TEST_DB for host in ("@127.0.0.1", "@localhost")):
        raise RuntimeError("TEST_DATABASE_URL must point to localhost: the tests drop tables")
    conn = await asyncpg.connect(TEST_DB)
    try:
        # Supabase-Rollen und auth.users gibt es nur in Supabase. Hier nachbilden.
        for role in ("anon", "authenticated"):
            await conn.execute(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                f"EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            )
        # Lokaler Supabase-Stack hat auth.users schon (anderer Besitzer). CI nicht.
        if await conn.fetchval("SELECT to_regclass('auth.users')") is None:
            await conn.execute("CREATE SCHEMA IF NOT EXISTS auth")
            await conn.execute("CREATE TABLE auth.users (id uuid PRIMARY KEY)")
        await conn.execute("DROP TABLE IF EXISTS public.messages, public.chats")
        for migration in MIGRATIONS:
            await conn.execute(migration.read_text())
        await conn.execute(
            "INSERT INTO auth.users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING",
            USER_A, USER_B,
        )
    finally:
        await conn.close()


async def _clear_chats():
    conn = await asyncpg.connect(TEST_DB)
    try:
        await conn.execute("DELETE FROM public.chats")  # messages folgen per CASCADE
        # Ein Test löscht Nutzer A (Cascade-Test). Die Testnutzer für den nächsten Test neu anlegen.
        await conn.execute(
            "INSERT INTO auth.users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING",
            USER_A, USER_B,
        )
    finally:
        await conn.close()


class _ChatTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        asyncio.run(_prepare_schema())
        cls.client = TestClient(main.app)
        cls.client.__enter__()  # startet lifespan → Pool

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        main.app.dependency_overrides.clear()

    def as_user(self, user_id):
        """Simuliert einen angemeldeten Nutzer (user_id kommt sonst aus dem Token)."""
        main.app.dependency_overrides[current_user] = lambda: user_id

    def setUp(self):
        asyncio.run(_clear_chats())
        self.as_user(USER_A)

    def _chat(self, chat_id="c1", title="Test", msg_count=2):
        return {
            "id": chat_id,
            "title": title,
            "timestamp": 1_700_000_000_000,
            "pinned": False,
            "messages": [
                {
                    "id": f"{chat_id}-m{i}",
                    "role": "user" if i % 2 == 0 else "assistant",
                    "content": f"msg {i}",
                    "via": "send",
                }
                for i in range(msg_count)
            ],
        }


class TestChatsEndpoints(_ChatTestCase):
    def test_empty_initially(self):
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_put_then_get_roundtrip(self):
        chat = self._chat()
        r = self.client.put(f"/chats/{chat['id']}", json=chat)
        self.assertEqual(r.status_code, 200)

        result = self.client.get("/chats").json()
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["id"], "c1")
        self.assertEqual(len(result[0]["messages"]), 2)
        self.assertEqual(result[0]["messages"][0]["content"], "msg 0")

    def test_put_replaces_messages(self):
        self.client.put("/chats/c1", json=self._chat(msg_count=3))
        self.client.put("/chats/c1", json=self._chat(msg_count=1))
        result = self.client.get("/chats").json()
        self.assertEqual(len(result[0]["messages"]), 1)

    def test_delete(self):
        self.client.put("/chats/c1", json=self._chat())
        r = self.client.delete("/chats/c1")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_delete_unknown_returns_404(self):
        self.assertEqual(self.client.delete("/chats/ghost").status_code, 404)

    def test_url_body_id_mismatch(self):
        chat = self._chat(chat_id="real")
        r = self.client.put("/chats/different", json=chat)
        self.assertEqual(r.status_code, 400)

    def test_user_id_in_body_is_ignored(self):
        # Angriff: Nutzer A versucht, einen Chat für Nutzer B anzulegen.
        chat = self._chat()
        chat["user_id"] = USER_B
        self.client.put("/chats/c1", json=chat)

        self.assertEqual(len(self.client.get("/chats").json()), 1)
        self.as_user(USER_B)
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_without_token_is_401(self):
        main.app.dependency_overrides.pop(current_user, None)
        self.assertEqual(self.client.get("/chats").status_code, 401)
        self.assertEqual(self.client.put("/chats/c1", json=self._chat()).status_code, 401)
        self.assertEqual(self.client.delete("/chats/c1").status_code, 401)


class TestIsolation(_ChatTestCase):
    def test_user_b_does_not_see_user_a_chats(self):
        self.client.put("/chats/c1", json=self._chat())
        self.as_user(USER_B)
        self.assertEqual(self.client.get("/chats").json(), [])

    def test_same_chat_id_is_two_separate_chats(self):
        self.client.put("/chats/c1", json=self._chat(title="Chat von A"))
        self.as_user(USER_B)
        self.client.put("/chats/c1", json=self._chat(title="Chat von B"))

        self.assertEqual(self.client.get("/chats").json()[0]["title"], "Chat von B")
        self.as_user(USER_A)
        self.assertEqual(self.client.get("/chats").json()[0]["title"], "Chat von A")

    def test_user_b_cannot_delete_user_a_chat(self):
        self.client.put("/chats/c1", json=self._chat())
        self.as_user(USER_B)
        self.assertEqual(self.client.delete("/chats/c1").status_code, 404)

        self.as_user(USER_A)
        self.assertEqual(len(self.client.get("/chats").json()), 1)


class TestAccountDeletion(_ChatTestCase):
    def test_deleting_auth_user_removes_their_chats_and_messages(self):
        self.client.put("/chats/c1", json=self._chat())
        self.client.put("/chats/c2", json=self._chat(chat_id="c2"))

        async def delete_user_a():
            conn = await asyncpg.connect(TEST_DB)
            try:
                await conn.execute("DELETE FROM auth.users WHERE id = $1", USER_A)
                return (
                    await conn.fetchval("SELECT count(*) FROM public.chats WHERE user_id = $1", USER_A),
                    await conn.fetchval("SELECT count(*) FROM public.messages WHERE user_id = $1", USER_A),
                )
            finally:
                await conn.close()

        chats_left, messages_left = asyncio.run(delete_user_a())
        self.assertEqual((chats_left, messages_left), (0, 0))


if __name__ == "__main__":
    unittest.main()
