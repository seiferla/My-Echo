"""Testnutzer und Tokens für den Lasttest (Issue #218).

Legt Nutzer `lt-user-001@loadtest.local` ... an (falls es sie noch nicht gibt),
löscht ihre Chats (sauberer Start pro Lauf) und stellt ihre Tokens VOR dem Test aus.
Während des Tests gibt es dadurch keine Anmeldungen bei Supabase (siehe ADR 0002).

Gebraucht werden: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, DATABASE_URL.
`load_settings()` liest sie aus der Umgebung oder, lokal, aus `supabase status`.
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

DOMAIN = "loadtest.local"
PASSWORD = "lt-password-Do-Not-Use-123"  # nur für Wegwerf-Nutzer im Testprojekt


def load_settings(repo_root: str) -> dict:
    keys = ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"]
    settings = {k: os.getenv(k) for k in keys}
    if all(settings.values()):
        return settings
    # Lokal: den Supabase-Stack fragen (npx supabase start muss laufen).
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


def ensure_users(settings: dict, count: int) -> None:
    """Legt fehlende Nutzer an. Gibt es einen schon, ist das in Ordnung."""
    secret = settings["SUPABASE_SECRET_KEY"]
    for i in range(1, count + 1):
        status, body = _post(
            f"{settings['SUPABASE_URL']}/auth/v1/admin/users",
            {"apikey": secret, "Authorization": f"Bearer {secret}"},
            {"email": email(i), "password": PASSWORD, "email_confirm": True},
        )
        if status not in (200, 201, 422):  # 422 = gibt es schon
            raise SystemExit(f"could not create {email(i)}: HTTP {status} {body}")


def issue_tokens(settings: dict, count: int) -> list[dict]:
    """Meldet jeden Nutzer einmal an und gibt Token + user_id zurück."""
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
    """Löscht Chats, Phrasen und Statistik der Testnutzer. Gibt die Zahl gelöschter Chats zurück."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(settings["DATABASE_URL"])
        try:
            ids = [r["id"] for r in await conn.fetch(
                "SELECT id FROM auth.users WHERE email LIKE $1", f"%@{DOMAIN}")]
            deleted = await conn.fetchval(
                "WITH d AS (DELETE FROM public.chats WHERE user_id = ANY($1::uuid[]) RETURNING 1) "
                "SELECT count(*) FROM d", ids)
            await conn.execute("DELETE FROM public.phrase_stores WHERE user_id = ANY($1::uuid[])", ids)
            await conn.execute("DELETE FROM public.tts_daily_stats WHERE user_id = ANY($1::uuid[])", ids)
            return deleted
        finally:
            await conn.close()
    return asyncio.run(run())


def delete_users(settings: dict) -> int:
    """Entfernt alle Testnutzer samt Daten (ON DELETE CASCADE)."""
    import asyncpg

    async def run():
        conn = await asyncpg.connect(settings["DATABASE_URL"])
        try:
            return await conn.fetchval(
                "WITH d AS (DELETE FROM auth.users WHERE email LIKE $1 RETURNING 1) SELECT count(*) FROM d",
                f"%@{DOMAIN}")
        finally:
            await conn.close()
    return asyncio.run(run())


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
