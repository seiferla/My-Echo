"""Test users and tokens for the load test.

Creates users lt-user-001@loadtest.local ... if missing, clears their data and issues their
tokens BEFORE the test, so there are no logins during the run (ADR 0002).

    python loadtest/prepare.py [count]     # default 5, tokens go to loadtest/.tokens.json
    python loadtest/prepare.py cleanup     # deletes all test users and their data
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

import asyncpg

DOMAIN = "loadtest.local"
PASSWORD = "lt-password-Do-Not-Use-123"  # only for throwaway users in a test project


def load_settings(repo_root: str) -> dict:
    """Reads the settings from the environment, or locally from `supabase status`."""
    keys = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"]
    settings = {k: os.getenv(k) for k in keys}
    if all(settings.values()):
        return settings
    out = subprocess.run(["npx", "--yes", "supabase", "status", "-o", "env"], cwd=repo_root,
                         capture_output=True, text=True, check=True).stdout
    status = dict(line.split("=", 1) for line in out.splitlines() if "=" in line)
    status = {k: v.strip().strip('"') for k, v in status.items()}
    settings["SUPABASE_URL"] = settings["SUPABASE_URL"] or status["API_URL"]
    settings["SUPABASE_PUBLISHABLE_KEY"] = settings["SUPABASE_PUBLISHABLE_KEY"] or status["PUBLISHABLE_KEY"]
    settings["SUPABASE_SECRET_KEY"] = settings["SUPABASE_SECRET_KEY"] or status["SECRET_KEY"]
    settings["DATABASE_URL"] = settings["DATABASE_URL"] or status["DB_URL"]
    return settings


def email(i: int) -> str:
    return f"lt-user-{i:03d}@{DOMAIN}"


def _post(url: str, headers: dict, body: dict) -> tuple[int, dict]:
    request = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(request, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def _with_db(settings: dict, action):
    """Runs `action(conn)` on the database and closes the connection afterwards."""
    async def run():
        conn = await asyncpg.connect(settings["DATABASE_URL"])
        try:
            return await action(conn)
        finally:
            await conn.close()
    return asyncio.run(run())


def ensure_users(settings: dict, count: int) -> None:
    secret = settings["SUPABASE_SECRET_KEY"]
    for i in range(1, count + 1):
        status, body = _post(
            f"{settings['SUPABASE_URL']}/auth/v1/admin/users",
            {"apikey": secret, "Authorization": f"Bearer {secret}"},
            {"email": email(i), "password": PASSWORD, "email_confirm": True},
        )
        if status not in (200, 201, 422):  # 422 = user exists already
            raise SystemExit(f"could not create {email(i)}: HTTP {status} {body}")


def issue_tokens(settings: dict, count: int) -> list[dict]:
    tokens = []
    for i in range(1, count + 1):
        status, body = _post(
            f"{settings['SUPABASE_URL']}/auth/v1/token?grant_type=password",
            {"apikey": settings["SUPABASE_PUBLISHABLE_KEY"]},
            {"email": email(i), "password": PASSWORD},
        )
        if status != 200:
            raise SystemExit(f"login of {email(i)} failed: HTTP {status}")
        tokens.append({"index": i, "user_id": body["user"]["id"], "token": body["access_token"]})
    return tokens


def clean_data(settings: dict) -> int:
    """Deletes chats, phrases and stats of the test users. Returns the number of deleted chats."""
    async def action(conn):
        ids = [r["id"] for r in await conn.fetch(
            "SELECT id FROM auth.users WHERE email LIKE $1", f"%@{DOMAIN}")]
        deleted = await conn.fetchval(
            "WITH d AS (DELETE FROM public.chats WHERE user_id = ANY($1::uuid[]) RETURNING 1) "
            "SELECT count(*) FROM d", ids)
        await conn.execute("DELETE FROM public.phrase_stores WHERE user_id = ANY($1::uuid[])", ids)
        await conn.execute("DELETE FROM public.tts_daily_stats WHERE user_id = ANY($1::uuid[])", ids)
        return deleted
    return _with_db(settings, action)


def delete_users(settings: dict) -> int:
    """Deletes all test users. Their data goes with them (ON DELETE CASCADE)."""
    return _with_db(settings, lambda conn: conn.fetchval(
        "WITH d AS (DELETE FROM auth.users WHERE email LIKE $1 RETURNING 1) SELECT count(*) FROM d",
        f"%@{DOMAIN}"))


def prepare(settings: dict, count: int, tokens_path: str) -> None:
    ensure_users(settings, count)
    clean_data(settings)
    tokens = issue_tokens(settings, count)
    os.makedirs(os.path.dirname(os.path.abspath(tokens_path)), exist_ok=True)
    with open(tokens_path, "w") as f:
        json.dump(tokens, f)


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    cfg = load_settings(root)
    if len(sys.argv) >= 2 and sys.argv[1] == "cleanup":
        print(f"deleted {delete_users(cfg)} load test users (their data went with them)")
    else:
        n = int(sys.argv[1]) if len(sys.argv) >= 2 else 5
        prepare(cfg, n, os.path.join(root, "loadtest", ".tokens.json"))
        print(f"{n} users ready, tokens in loadtest/.tokens.json (not committed)")
