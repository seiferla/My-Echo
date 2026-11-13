#!/usr/bin/env bash
# Backup of the app tables (public schema) from Supabase, and restore.
# Usage (in deploy/):  ./backup.sh                          -> backups/myecho-<time>.dump
#                      ./backup.sh restore <file> <db-url>  -> restore into another database
# Restore only into a TEST database (e.g. local `npx supabase start`), never blind into production.
set -euo pipefail
cd "$(dirname "$0")"
env_get() { grep -E "^$1=" .env | tail -n 1 | cut -d= -f2- || true; }
PG_IMAGE=postgres:17   # same major version as Supabase (supabase/config.toml)

if [ "${1:-}" = "restore" ]; then
  file=${2:?file missing}
  target=${3:?target database URL missing}
  [ -f "$file" ] || { echo "No such file: $file" >&2; exit 1; }
  TARGET_URL=$target docker run --rm --network host -e TARGET_URL \
    -v "$(cd "$(dirname "$file")" && pwd):/backup:ro" $PG_IMAGE \
    sh -c "pg_restore --clean --if-exists --no-owner --no-privileges -d \"\$TARGET_URL\" /backup/$(basename "$file")"
  echo "Restored $file"
  exit 0
fi

mkdir -p backups
chmod 700 backups
name="myecho-$(date +%Y%m%d-%H%M%S).dump"
DB_URL=$(env_get DATABASE_URL) docker run --rm -e DB_URL -v "$PWD/backups:/backup" $PG_IMAGE \
  sh -c "pg_dump \"\$DB_URL\" --schema=public -Fc -f /backup/$name"
chmod 600 "backups/$name"
echo "Backup written: deploy/backups/$name ($(du -h "backups/$name" | cut -f1))"
# Keep the newest 14 backups.
ls -1t backups/myecho-*.dump | tail -n +15 | xargs -r rm --
