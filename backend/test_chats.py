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
        await conn.execute(
            "DROP TABLE IF EXISTS public.messages, public.chats, "
            "public.phrase_stores, public.tts_daily_stats"
        )
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
        await conn.execute("DELETE FROM public.phrase_stores")
        await conn.execute("DELETE FROM public.tts_daily_stats")
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


def _phrase_store(text="Ja", updated_at=100, visible=3):
    return {
        "phrases": [{"id": "p1", "text": text, "useCount": 2, "createdAt": 1_700_000_000_000}],
        "settings": {"visibleCount": visible, "instantEnabled": True},
        "updatedAt": updated_at,
    }


class TestPhrases(_ChatTestCase):
    def test_empty_initially_returns_null(self):
        r = self.client.get("/phrases")
        self.assertEqual(r.status_code, 200)
        self.assertIsNone(r.json())

    def test_put_then_get_roundtrip(self):
        r = self.client.put("/phrases", json=_phrase_store())
        self.assertEqual(r.json(), {"status": "ok"})

        stored = self.client.get("/phrases").json()
        self.assertEqual(stored["phrases"][0]["text"], "Ja")
        self.assertEqual(stored["settings"], {"visibleCount": 3, "instantEnabled": True})
        self.assertEqual(stored["updatedAt"], 100)

    def test_newer_store_replaces_older(self):
        self.client.put("/phrases", json=_phrase_store(text="alt", updated_at=100))
        r = self.client.put("/phrases", json=_phrase_store(text="neu", updated_at=200))
        self.assertEqual(r.json(), {"status": "ok"})
        self.assertEqual(self.client.get("/phrases").json()["phrases"][0]["text"], "neu")

    def test_older_store_does_not_overwrite_newer(self):
        self.client.put("/phrases", json=_phrase_store(text="neu", updated_at=200))
        r = self.client.put("/phrases", json=_phrase_store(text="alt", updated_at=100))
        self.assertEqual(r.json(), {"status": "stale"})
        stored = self.client.get("/phrases").json()
        self.assertEqual((stored["phrases"][0]["text"], stored["updatedAt"]), ("neu", 200))

    def test_invalid_settings_are_rejected(self):
        self.assertEqual(self.client.put("/phrases", json=_phrase_store(visible=99)).status_code, 422)

    def test_too_many_phrases_are_rejected(self):
        store = _phrase_store()
        store["phrases"] = [dict(store["phrases"][0], id=f"p{i}") for i in range(201)]
        self.assertEqual(self.client.put("/phrases", json=store).status_code, 422)

    def test_without_token_is_401(self):
        main.app.dependency_overrides.pop(current_user, None)
        self.assertEqual(self.client.get("/phrases").status_code, 401)
        self.assertEqual(self.client.put("/phrases", json=_phrase_store()).status_code, 401)


class TestPhrasesIsolation(_ChatTestCase):
    def test_user_b_does_not_see_user_a_phrases(self):
        self.client.put("/phrases", json=_phrase_store(text="Geheim von A"))
        self.as_user(USER_B)
        self.assertIsNone(self.client.get("/phrases").json())

    def test_each_user_has_own_phrases(self):
        self.client.put("/phrases", json=_phrase_store(text="Phrase von A"))
        self.as_user(USER_B)
        self.client.put("/phrases", json=_phrase_store(text="Phrase von B", updated_at=50))

        self.assertEqual(self.client.get("/phrases").json()["phrases"][0]["text"], "Phrase von B")
        self.as_user(USER_A)
        self.assertEqual(self.client.get("/phrases").json()["phrases"][0]["text"], "Phrase von A")

    def test_user_b_cannot_overwrite_user_a_phrases(self):
        # B schickt einen "neueren" Stand: er landet bei B, A bleibt unberührt.
        self.client.put("/phrases", json=_phrase_store(text="Phrase von A", updated_at=100))
        self.as_user(USER_B)
        self.client.put("/phrases", json=_phrase_store(text="Angriff von B", updated_at=999))
        self.as_user(USER_A)
        self.assertEqual(self.client.get("/phrases").json()["phrases"][0]["text"], "Phrase von A")


class TestTtsStats(_ChatTestCase):
    DAY = "2026-10-19"

    def _post(self, **day_stat):
        stat = {"requests": 0, "chars": 0, "durationMs": 0, **day_stat}
        return self.client.post("/stats/tts", json={self.DAY: stat})

    def test_empty_initially(self):
        self.assertEqual(self.client.get("/stats/tts").json(), {})

    def test_post_then_get(self):
        self.assertEqual(self._post(requests=3, chars=120, durationMs=4000).status_code, 200)
        self.assertEqual(
            self.client.get("/stats/tts").json(),
            {self.DAY: {"requests": 3, "chars": 120, "durationMs": 4000}},
        )

    def test_merge_keeps_the_larger_value_per_field(self):
        self._post(requests=5, chars=100, durationMs=1000)
        self._post(requests=3, chars=200, durationMs=500)  # ein Feld größer, zwei kleiner
        self.assertEqual(
            self.client.get("/stats/tts").json()[self.DAY],
            {"requests": 5, "chars": 200, "durationMs": 1000},
        )

    def test_invalid_day_is_rejected(self):
        r = self.client.post("/stats/tts", json={"heute": {"requests": 1, "chars": 1, "durationMs": 1}})
        self.assertEqual(r.status_code, 422)

    def test_negative_values_are_rejected(self):
        self.assertEqual(self._post(requests=-1).status_code, 422)

    def test_too_many_days_are_rejected(self):
        zero = {"requests": 0, "chars": 0, "durationMs": 0}
        days = {f"{2000 + i // 365}-{(i % 365) // 31 + 1:02d}-{(i % 31) + 1:02d}": zero for i in range(900)}
        self.assertGreater(len(days), main.MAX_STAT_DAYS)
        self.assertEqual(self.client.post("/stats/tts", json=days).status_code, 413)

    def test_without_token_is_401(self):
        main.app.dependency_overrides.pop(current_user, None)
        self.assertEqual(self.client.get("/stats/tts").status_code, 401)
        self.assertEqual(self._post(requests=1).status_code, 401)

    def test_users_are_isolated(self):
        self._post(requests=7, chars=70, durationMs=700)
        self.as_user(USER_B)
        self.assertEqual(self.client.get("/stats/tts").json(), {})

        self._post(requests=1, chars=1, durationMs=1)
        self.as_user(USER_A)
        self.assertEqual(self.client.get("/stats/tts").json()[self.DAY]["requests"], 7)


def _fetch(sql: str):
    async def run():
        conn = await asyncpg.connect(TEST_DB)
        try:
            return await conn.fetch(sql)
        finally:
            await conn.close()
    return asyncio.run(run())


# Über Objekt-IDs statt Namen: Postgres darf Bedingungen in beliebiger Reihenfolge
# prüfen, ein Name aus einem anderen Schema darf also nie zu "public.<name>" werden.
PUBLIC_TABLES = (
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace"
    " WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')"
)


class TestSchemaSecurity(_ChatTestCase):
    """Sicherheitsnetz für G2: gilt automatisch auch für Tabellen, die später dazukommen."""

    def test_there_are_tables_to_check(self):
        # Schutz davor, dass die beiden Tests unten still eine leere Liste prüfen.
        rows = _fetch(PUBLIC_TABLES)
        self.assertGreaterEqual(len(rows), 4)

    def test_every_public_table_has_rls_on(self):
        rows = _fetch(PUBLIC_TABLES + " AND NOT c.relrowsecurity")
        self.assertEqual([r["relname"] for r in rows], [])

    def test_api_roles_have_no_table_privileges(self):
        # anon und authenticated sind die Rollen der öffentlichen Supabase-API.
        rows = _fetch(
            """SELECT c.relname, r.role, p.priv
               FROM pg_class c
               JOIN pg_namespace n ON n.oid = c.relnamespace
               CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
               CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS p(priv)
               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                 AND has_table_privilege(r.role, c.oid, p.priv)"""
        )
        self.assertEqual([tuple(r) for r in rows], [])


SECRET_A = "Geheim-von-A"
STATS_A = {"2026-10-19": {"requests": 7, "chars": 70, "durationMs": 700}}

# Berechtigungsmatrix (G2): Ressource × Aktion × Akteur. Jede Zeile ist ein Testfall.
# Akteur "other" = angemeldeter Nutzer B, "none" = ohne Token.
# Erwartung: "other" sieht nichts von A und ändert nichts an A; "none" bekommt 401.
# Nicht in der Matrix: "usage" (G7) und "voice" (G3) gibt es noch nicht.
# Ein einzelnes Lesen gibt es nur über die Liste (GET /chats), daher read = list.
MATRIX = [
    # (Ressource, Aktion, Methode, Pfad, Body)
    ("chat", "list", "GET", "/chats", None),
    ("chat", "write", "PUT", "/chats/c1", "chat"),
    ("chat", "delete", "DELETE", "/chats/c1", None),
    ("message", "list", "GET", "/chats", None),
    ("message", "write", "PUT", "/chats/c1", "chat"),
    ("phrases", "read", "GET", "/phrases", None),
    ("phrases", "write", "PUT", "/phrases", "phrases"),
    ("statistics", "read", "GET", "/stats/tts", None),
    ("statistics", "write", "POST", "/stats/tts", "stats"),
]


class TestAuthorizationMatrix(_ChatTestCase):
    def _seed_user_a(self):
        chat = self._chat(title=f"Titel {SECRET_A}")
        chat["messages"][0]["content"] = f"Nachricht {SECRET_A}"
        self.client.put("/chats/c1", json=chat)
        self.client.put("/phrases", json=_phrase_store(text=f"Phrase {SECRET_A}", updated_at=100))
        self.client.post("/stats/tts", json=STATS_A)

    def _snapshot_a(self):
        self.as_user(USER_A)
        return (
            self.client.get("/chats").json(),
            self.client.get("/phrases").json(),
            self.client.get("/stats/tts").json(),
        )

    def _body(self, kind):
        # Angriffs-Payloads: neuer, größer, "wichtiger" als die Daten von A.
        if kind == "chat":
            chat = self._chat(title="von B")
            chat["messages"][0]["content"] = "von B"
            return chat
        if kind == "phrases":
            return _phrase_store(text="von B", updated_at=999_999)
        if kind == "stats":
            return {"2026-10-19": {"requests": 999, "chars": 999, "durationMs": 999}}
        return None

    def _run(self, actor):
        self._seed_user_a()
        before = self._snapshot_a()
        self.assertIn(SECRET_A, str(before))  # A hat wirklich Daten, sonst wäre der Test wertlos

        for resource, action, method, path, body in MATRIX:
            with self.subTest(resource=resource, action=action, actor=actor):
                if actor == "other":
                    self.as_user(USER_B)
                else:
                    main.app.dependency_overrides.pop(current_user, None)
                r = self.client.request(method, path, json=self._body(body))

                if actor == "none":
                    self.assertEqual(r.status_code, 401)
                else:
                    self.assertNotIn(SECRET_A, r.text)  # B sieht nichts von A
                    self.assertNotIn(r.status_code, (401, 403, 500), r.text)

                self.assertEqual(self._snapshot_a(), before)  # A ist unverändert

    def test_other_user_cannot_see_or_change_user_a_data(self):
        self._run("other")

    def test_no_user_gets_401_and_changes_nothing(self):
        self._run("none")


class TestNoMessageTextInLogs(_ChatTestCase):
    """G8: Texte aus Chats und Phrasen dürfen in keinem Log stehen."""

    def test_chats_and_phrases_never_log_their_text(self):
        from test_logging import LogCapture, MARKER

        chat = self._chat()
        chat["title"] = f"Titel {MARKER}"
        chat["messages"][0]["content"] = f"Nachricht {MARKER}"
        with LogCapture() as logs:
            self.client.put("/chats/c1", json=chat)
            self.client.get("/chats")
            self.client.put("/phrases", json=_phrase_store(text=f"Phrase {MARKER}"))
            self.client.get("/phrases")
            self.client.delete("/chats/c1")
        self.assertFalse([line for line in logs.lines if MARKER in line])


class TestAccountDeletion(_ChatTestCase):
    def test_deleting_auth_user_removes_all_their_data(self):
        self.client.put("/chats/c1", json=self._chat())
        self.client.put("/chats/c2", json=self._chat(chat_id="c2"))
        self.client.put("/phrases", json=_phrase_store())
        self.client.post(
            "/stats/tts", json={"2026-10-19": {"requests": 1, "chars": 1, "durationMs": 1}}
        )

        async def delete_user_a():
            conn = await asyncpg.connect(TEST_DB)
            try:
                await conn.execute("DELETE FROM auth.users WHERE id = $1", USER_A)
                return [
                    await conn.fetchval(f"SELECT count(*) FROM public.{table} WHERE user_id = $1", USER_A)
                    for table in ("chats", "messages", "phrase_stores", "tts_daily_stats")
                ]
            finally:
                await conn.close()

        self.assertEqual(asyncio.run(delete_user_a()), [0, 0, 0, 0])


if __name__ == "__main__":
    unittest.main()
