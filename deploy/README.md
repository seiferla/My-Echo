# Deploy myEcho backend (VM + Docker Compose + Caddy)

Database and auth are at Supabase. The server only runs the backend and Caddy (HTTPS).
The backend image is built on the server from `backend/` (branch `multiuser`).

```
App ──HTTPS──> Caddy (:443) ──> backend (:4444, not public) ──> Supabase Postgres (pooler)
 └──────────── login ─────────────────────────────────────────> Supabase Auth
```

## 1. Once, in the Supabase dashboard

- Authentication: turn **sign-ups off**. Create users by hand (confirmed e-mail).
- Authentication > Sessions: access token 3600 s, refresh token rotation on (ADR 0002).
- Project settings > Data API: turn it off (the app only talks to the backend).
- Database > Advisors > Security: no "RLS disabled" warning.
- Optional, after the backend works: Database > Network Restrictions -> only the server IP.

## 2. Once, DNS

A record for your domain -> server IP. Check: `dig +short <domain>`.
DuckDNS is fine for tests (duckdns.org, set "current ip").

## 3. Once, on the server

```bash
git clone -b multiuser https://github.com/seiferla/My-Echo.git && cd My-Echo/deploy
sudo bash setup.sh          # Docker, firewall, fail2ban, docker group
exit                        # log in again so the docker group works
```

```bash
cd ~/My-Echo/deploy
cp .env.example .env && nano .env
./deploy.sh
```

`deploy.sh` checks `.env`, pulls the code, applies `supabase/migrations`, builds and starts
the containers, and tests `/health` (200), `/chats` (401) and `/docs` (not public).
It prints how long the deploy took (G4).

## Update

```bash
cd ~/My-Echo/deploy && ./deploy.sh
```

Do not edit files on the server. Change them in the repo, push, then run `./deploy.sh`.

## Logs

```bash
docker compose ps
docker compose logs backend --tail 50
docker compose logs caddy --tail 50
```

| Problem | Cause |
|---|---|
| `tenant/user ... not found` | `DATABASE_URL` user is not `postgres.<project-ref>` |
| `Network is unreachable` | direct connection (IPv6) used; use the Session pooler |
| `password authentication failed` | wrong password, or special characters not URL-encoded |
| Caddy certificate error | DNS does not point to the server, or port 80 blocked |
| `permission denied ... docker.sock` | not logged in again after `setup.sh` |

## Backup / restore (G4)

```bash
./backup.sh                                     # -> backups/myecho-<time>.dump (keeps 14)
./backup.sh restore backups/<file>.dump "<test-db-url>"
```

Restore once into a test database (for example a local `npx supabase start`,
`postgresql://postgres:postgres@127.0.0.1:54322/postgres`) and write the result down.
Daily backup with cron (`crontab -e`):

```
0 3 * * * cd /home/<user>/My-Echo/deploy && ./backup.sh >> backups/backup.log 2>&1
```

Backups contain user data. Keep them on the server or in encrypted storage only.

## Terraform (optional, Hetzner: empty project -> running VM)

See `terraform/`. It creates the VM and firewall, clones `multiuser` and runs `setup.sh`.
You still copy `.env` to the VM and run `./deploy.sh` (secrets stay out of the repo).
