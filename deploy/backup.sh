#!/usr/bin/env bash
# Backup of the app tables (public schema) from Supabase, restore, and a restore test.
# Usage (in deploy/):
#   ./backup.sh                          -> backups/myecho-<time>.dump (keeps the newest 14)
#   ./backup.sh verify                   -> backup + restore into a throwaway Postgres + compare (G4)
#   ./backup.sh restore <file> <db-url>  -> restore into another database (a TEST database!)
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

if [ "${1:-}" = "verify" ]; then
  START=$(date +%s)
  net=myecho-restore-net
  db=myecho-restore-db
  cleanup() { docker rm -f "$db" >/dev/null 2>&1 || true; docker network rm "$net" >/dev/null 2>&1 || true; }
  trap cleanup EXIT
  cleanup

  echo "==> 1/4 Backup"
  bash "$0"
  file=$(ls -1t backups/myecho-*.dump | head -n 1)

  echo "==> 2/4 Start a throwaway Postgres"
  docker network create "$net" >/dev/null
  docker run -d --name "$db" --network "$net" -e POSTGRES_PASSWORD=restore-test $PG_IMAGE >/dev/null
  # Check over TCP: during first start the server only listens on the socket.
  for _ in $(seq 1 60); do
    docker exec "$db" psql -h 127.0.0.1 -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  TARGET="postgresql://postgres:restore-test@$db:5432/postgres"

  echo "==> 3/4 Restore $file"
  # auth.users is not part of the backup (Supabase owns it). A stub is needed for the foreign keys,
  # filled with the user ids found in the data, between the data and the constraints.
  docker run --rm -i --network "$net" -e T="$TARGET" -e FILE="/backup/$(basename "$file")" \
    -v "$PWD/backups:/backup:ro" $PG_IMAGE bash -s <<'RESTORE'
set -euo pipefail
psql "$T" -q -v ON_ERROR_STOP=1 -c "drop schema public cascade; create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated;"
pg_restore --no-owner --no-privileges --section=pre-data -d "$T" "$FILE"
pg_restore --no-owner --no-privileges --section=data -d "$T" "$FILE"
psql "$T" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ declare r record; begin
  for r in select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id' loop
    execute format('insert into auth.users select distinct user_id from public.%I on conflict do nothing', r.table_name);
  end loop;
end $$;
SQL
pg_restore --no-owner --no-privileges --section=post-data -d "$T" "$FILE"
RESTORE

  echo "==> 4/4 Compare source and restored database"
  rc=0
  SOURCE=$(env_get DATABASE_URL)
  docker run --rm -i --network "$net" -e SRC="$SOURCE" -e T="$TARGET" \
    $PG_IMAGE bash -s <<'COMPARE' || rc=$?
set -uo pipefail
fail=0
for t in $(psql "$SRC" -tAc "select tablename from pg_tables where schemaname = 'public' order by 1"); do
  a=$(psql "$SRC" -tAc "select count(*) from public.\"$t\"")
  b=$(psql "$T" -tAc "select count(*) from public.\"$t\"" 2>/dev/null || echo missing)
  if [ "$a" = "$b" ]; then echo "ok   $t: $a rows"; else echo "FAIL $t: source $a, restored $b"; fail=1; fi
done
off=$(psql "$T" -tAc "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity")
if [ "$off" = "0" ]; then echo "ok   RLS is on for every restored table"; else echo "FAIL $off table(s) without RLS"; fail=1; fi
exit $fail
COMPARE
  echo
  echo "Backup and restore test took $(( $(date +%s) - START )) s"
  [ "$rc" -eq 0 ] && echo "RESTORE TEST PASSED" || { echo "RESTORE TEST FAILED"; exit 1; }
  exit 0
fi

mkdir -p backups
chmod 700 backups
name="myecho-$(date +%Y%m%d-%H%M%S).dump"
# Run as the current user, so the dump file is not owned by root.
DB_URL=$(env_get DATABASE_URL) docker run --rm --user "$(id -u):$(id -g)" -e DB_URL -v "$PWD/backups:/backup" $PG_IMAGE \
  sh -c "pg_dump \"\$DB_URL\" --schema=public -Fc -f /backup/$name"
chmod 600 "backups/$name"
echo "Backup written: deploy/backups/$name ($(du -h "backups/$name" | cut -f1))"
# Keep the newest 14 backups.
ls -1t backups/myecho-*.dump | tail -n +15 | xargs -r rm --
