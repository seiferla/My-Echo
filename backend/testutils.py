"""Shared helpers for the backend tests (not a test module itself)."""
import asyncio
import logging
import os
import pathlib
import time
from types import SimpleNamespace

import asyncpg
import jwt
from cryptography.hazmat.primitives.asymmetric import ec

# --- Tokens: a local key pair signs test tokens, no network needed ---------------

ISS = "https://test.supabase.co/auth/v1"
KEY = ec.generate_private_key(ec.SECP256R1())
OTHER_KEY = ec.generate_private_key(ec.SECP256R1())


def make_claims(**overrides) -> dict:
    claims = {"sub": "user-1", "aud": "authenticated", "iss": ISS, "exp": int(time.time()) + 300}
    claims.update(overrides)
    return claims


def bearer(user_id: str) -> dict:
    token = jwt.encode(make_claims(sub=user_id), KEY, algorithm="ES256")
    return {"Authorization": f"Bearer {token}"}


class FakeJwks:
    """Replaces the JWKS download and always returns the public test key."""

    def get_signing_key_from_jwt(self, token):
        return SimpleNamespace(key=KEY.public_key())


# --- Mock TTS --------------------------------------------------------------------

FAST_MOCK = {"MOCK_TTS_FIRST_AUDIO_MS": "0", "MOCK_TTS_CHUNK_MS": "0"}

# --- Logs --------------------------------------------------------------------------

MARKER = "SECRET-7f3a"


class LogCapture(logging.Handler):
    """Collects all log lines, except the test client's (httpx logs the full URL)."""

    def __init__(self):
        super().__init__(logging.DEBUG)
        self.lines: list[str] = []

    def emit(self, record):
        if not record.name.startswith("httpx"):
            self.lines.append(f"{record.name}: {record.getMessage()}")

    def __enter__(self):
        root = logging.getLogger()
        self._old_level = root.level
        root.setLevel(logging.DEBUG)
        root.addHandler(self)
        return self

    def __exit__(self, *exc):
        root = logging.getLogger()
        root.removeHandler(self)
        root.setLevel(self._old_level)


# --- Test database (local Supabase or the CI Postgres) ------------------------------

TEST_DB = os.getenv("TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
MIGRATIONS = sorted((pathlib.Path(__file__).parent.parent / "supabase" / "migrations").glob("*.sql"))
USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"
USER_TABLES = ("chats", "messages", "phrase_stores", "tts_daily_stats", "user_voices")


def with_test_db(action):
    """Runs `await action(conn)` on the test database and returns the result."""
    async def run():
        conn = await asyncpg.connect(TEST_DB)
        try:
            return await action(conn)
        finally:
            await conn.close()
    return asyncio.run(run())


async def _add_test_users(conn) -> None:
    await conn.execute("INSERT INTO auth.users (id) VALUES ($1), ($2) ON CONFLICT DO NOTHING", USER_A, USER_B)


def prepare_schema() -> None:
    """Recreates the tables from the real migrations."""
    # The tests drop tables, so never run them against a remote database.
    if not any(host in TEST_DB for host in ("@127.0.0.1", "@localhost")):
        raise RuntimeError("TEST_DATABASE_URL must point to localhost: the tests drop tables")

    async def run(conn):
        # Supabase roles and auth.users exist only in Supabase; create them for plain Postgres.
        for role in ("anon", "authenticated"):
            await conn.execute(
                f"DO $$ BEGIN CREATE ROLE {role} NOLOGIN; "
                f"EXCEPTION WHEN duplicate_object THEN NULL; END $$"
            )
        if await conn.fetchval("SELECT to_regclass('auth.users')") is None:
            await conn.execute("CREATE SCHEMA IF NOT EXISTS auth")
            await conn.execute("CREATE TABLE auth.users (id uuid PRIMARY KEY)")
        await conn.execute("DROP TABLE IF EXISTS " + ", ".join(f"public.{t}" for t in USER_TABLES))
        for migration in MIGRATIONS:
            await conn.execute(migration.read_text())
        await _add_test_users(conn)

    with_test_db(run)


def clear_user_data() -> None:
    """Deletes all rows and creates the test users again (one test deletes USER_A)."""
    async def run(conn):
        await conn.execute("DELETE FROM public.chats")  # messages go with them (CASCADE)
        await conn.execute("DELETE FROM public.phrase_stores")
        await conn.execute("DELETE FROM public.tts_daily_stats")
        await conn.execute("DELETE FROM public.user_voices")
        await _add_test_users(conn)

    with_test_db(run)
