# Deploy myEcho backend (Hetzner VM + Docker Compose + Caddy)

Database and auth are at Supabase. The VM only runs the backend and Caddy (HTTPS).

## 1. Prepare once

- DNS: A record `api.<your-domain>` -> VM IP.
- Supabase: apply the schema from the repo (from your laptop, project linked):
  ```bash
  npx supabase db push
  ```
- Supabase: Auth > turn **sign-ups off**; create users in the dashboard (confirmed e-mail).

## 2. On the VM (as root)

```bash
git clone https://github.com/seiferla/My-Echo.git && cd My-Echo/deploy
sudo bash setup.sh                 # Docker, firewall, fail2ban
cp .env.example .env && nano .env  # fill in the values; chmod 600 .env
docker compose up -d
```

## 3. Check

```bash
docker compose ps                         # backend must be "healthy"
curl -i https://api.<your-domain>/health  # 200
curl -i https://api.<your-domain>/chats   # 401 (no token = good)
docker compose logs -f
```

## Update

```bash
docker compose pull && docker compose up -d
```

## Backup / restore (G4)

State is in Supabase, not on the VM. Backup the database from your laptop:

```bash
pg_dump "$DATABASE_URL" -Fc -f myecho-$(date +%F).dump
pg_restore --clean --if-exists -d "$TARGET_DATABASE_URL" myecho-<date>.dump
```

Test the restore once on a local Supabase (`npx supabase start`) and write the result down.

## Terraform (optional, empty project -> running VM)

See `terraform/`. It creates the VM and firewall and runs `setup.sh` through cloud-init.
You still copy `.env` to the VM (secrets stay out of the repo).
