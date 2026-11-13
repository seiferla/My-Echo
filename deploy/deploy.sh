#!/usr/bin/env bash
# One command deploy (G4): check .env, update code, apply DB migrations, start, smoke test.
# Usage (in deploy/):  ./deploy.sh            full deploy
#                      ./deploy.sh --no-pull  skip git pull (deploy local state)
#                      ./deploy.sh --no-migrate
set -euo pipefail
cd "$(dirname "$0")"
START=$(date +%s)

PULL=1
MIGRATE=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --no-migrate) MIGRATE=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n==> %s\n' "$*"; }
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
# Read one value from .env without sourcing it (values may contain & ? $ and so on).
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }

step "Check .env"
[ -f .env ] || fail ".env is missing. Run: cp .env.example .env && nano .env"
chmod 600 .env
for key in DOMAIN SUPABASE_URL DATABASE_URL SUPABASE_SERVICE_ROLE_KEY METRICS_TOKEN; do
  value=$(env_get "$key")
  [ -n "$value" ] || fail "$key is empty in .env"
  case "$value" in *"<"*|*">"*|*"["*"]"*|*example.com*) fail "$key still has a placeholder" ;; esac
done
provider=$(env_get TTS_PROVIDER)
if [ "${provider:-mistral}" = "mistral" ] && [ -z "$(env_get TTS_API_KEY)" ]; then
  fail "TTS_API_KEY is empty (or set TTS_PROVIDER=mock for a test without costs)"
fi
DOMAIN=$(env_get DOMAIN)
echo "ok"

if [ "$PULL" -eq 1 ]; then
  step "Update code (git pull)"
  git -C .. pull --ff-only
fi

if [ "$MIGRATE" -eq 1 ]; then
  step "Apply database migrations (supabase/migrations)"
  # Supabase CLI in a throwaway container; it records applied files, so this is safe to repeat.
  # The repo folder is mounted read-only and copied, so the CLI cannot write into the repo.
  DB_URL=$(env_get DATABASE_URL) docker run --rm -e DB_URL \
    -v "$(cd .. && pwd)/supabase:/src/supabase:ro" \
    node:22-slim sh -c 'cp -r /src /work && cd /work &&
      npx --yes supabase@3.1.0 db push --remote="$DB_URL" --skip-vault --yes'
fi

step "Build and start containers"
docker compose up -d --build --remove-orphans

step "Wait for backend to be healthy"
for _ in $(seq 1 30); do
  status=$(docker inspect -f '{{.State.Health.Status}}' myecho-backend 2>/dev/null || echo missing)
  [ "$status" = "healthy" ] && break
  sleep 3
done
if [ "$status" != "healthy" ]; then
  docker compose logs backend --tail 30
  fail "backend is $status"
fi
echo "healthy"

step "Smoke test https://$DOMAIN (Caddy may need ~30 s for the first certificate)"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN$1" || echo 000; }
for _ in $(seq 1 12); do
  [ "$(code /health)" = "200" ] && break
  sleep 5
done
check() { # path, expected code
  got=$(code "$1")
  if [ "$got" = "$2" ]; then echo "ok   $1 -> $got"; else echo "FAIL $1 -> $got (expected $2)"; FAILED=1; fi
}
FAILED=0
check /health 200
check /chats 401   # no token -> must be rejected (G1)
check /voice 401
[ "$(code /docs)" = "200" ] && { echo "FAIL /docs is public"; FAILED=1; } || echo "ok   /docs is not public"

echo
echo "Deploy took $(( $(date +%s) - START )) s"
[ "$FAILED" -eq 0 ] || fail "smoke test failed, see above (docker compose logs caddy)"
echo "Done: https://$DOMAIN"
