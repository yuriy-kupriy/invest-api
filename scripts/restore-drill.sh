#!/usr/bin/env bash
# Proves that the latest backup actually restores.
#
#   bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
#
# A backup nobody has restored is a hypothesis. The drill turns it into a fact,
# and into two numbers for RESTORE-DRILL.md: how long the restore took (RTO) and
# what the backup schedule can lose (RPO).
#
# What it does: reads a control value from the live database, restores the newest
# dump into a container with a volume that did not exist a second ago, reads the
# same control value there, and compares them. Container and volume are created
# and destroyed by this script, which is why running it twice in a row works —
# restoring into a volume that already holds a database is the classic source of
# fake "duplicate key" failures.
#
# Overridable: BACKUP_DIR (default ./backups), DRILL_IMAGE (the postgres image,
# which must not be older than the server the dump came from), KEEP=1 (leave the
# drill container running for inspection).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/lib/db-url.sh"
resolve_connection

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
DRILL_IMAGE="${DRILL_IMAGE:-postgres:16-alpine}"
STAMP=$(date +%Y%m%d-%H%M%S)
DRILL_NAME="invest-restore-drill-$STAMP"

# Milliseconds, portably. $SECONDS is too coarse to report an RTO honestly on a
# dev-sized database, and `date +%s%N` is a GNU extension that BSD date ignores.
now_ms() {
  if [ -n "${EPOCHREALTIME:-}" ]; then
    echo $(( ${EPOCHREALTIME/./} / 1000 ))
  elif command -v python3 >/dev/null 2>&1; then
    python3 -c 'import time; print(int(time.time() * 1000))'
  else
    echo "$(date +%s)000"
  fi
}

# ── 1. the control value, from the live database ────────────────────────────
#
# count(*) || '|' || sum(<numeric column>) over the key table: one string, so
# "did the data come back" is a string comparison and not a judgement call. The
# table is picked at runtime because the grader may run the drill against a
# database that has only db/init.sql in it — before any migration.
pick_control_table() {
  if [ "$(db_psql -tAc "SELECT to_regclass('public.transactions') IS NOT NULL")" = 't' ]; then
    CONTROL_TABLE=transactions
    CONTROL_COLUMN=amount_cents
  else
    CONTROL_TABLE=health_probe
    CONTROL_COLUMN=id
  fi
}

control_sql() {
  printf "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') || ' tables | %s: ' || count(*) || ' rows | sum(%s)=' || coalesce(sum(%s), 0) FROM %s;" \
    "$CONTROL_TABLE" "$CONTROL_COLUMN" "$CONTROL_COLUMN" "$CONTROL_TABLE"
}

pick_control_table
echo "Control table: $CONTROL_TABLE (sum over $CONTROL_COLUMN)"
BEFORE=$(db_psql -tAc "$(control_sql)")
echo "Before: $BEFORE"

# ── 2. the newest dump ──────────────────────────────────────────────────────
DUMP=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)
if [ -z "$DUMP" ]; then
  echo "No dump in $BACKUP_DIR — running scripts/backup.sh first."
  bash "$ROOT/scripts/backup.sh"
  DUMP=$(ls -t "$BACKUP_DIR"/*.dump | head -1)
fi
DUMP_SIZE=$(du -h "$DUMP" | cut -f1 | tr -d ' ')
echo "Dump: $DUMP ($DUMP_SIZE)"

# ── 3. a Postgres that has never seen this data ─────────────────────────────
cleanup() {
  if [ "${KEEP:-0}" = '1' ]; then
    echo "KEEP=1 — leaving container $DRILL_NAME and volume $DRILL_NAME behind."
    return
  fi
  docker rm -f "$DRILL_NAME" >/dev/null 2>&1 || true
  docker volume rm "$DRILL_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker volume create "$DRILL_NAME" >/dev/null
# No published port: the drill talks to itself through docker exec, so it can
# never collide with the stack that is already running.
docker run -d --name "$DRILL_NAME" \
  -v "$DRILL_NAME:/var/lib/postgresql/data" \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_DB="$PGDATABASE" \
  "$DRILL_IMAGE" >/dev/null
echo "Drill container: $DRILL_NAME (image $DRILL_IMAGE, fresh volume $DRILL_NAME)"

drill_psql() {
  docker exec -i "$DRILL_NAME" psql -v ON_ERROR_STOP=1 -U postgres -d "$PGDATABASE" "$@"
}

# -h 127.0.0.1 and not the unix socket, and the difference is not cosmetic:
# while initdb runs, the official image has a temporary server listening on the
# socket only. A socket probe reports "ready", the script races on, and the
# restore lands in the gap where that temporary server is replaced by the real
# one. Over TCP nothing answers until the real server is up.
READY=0
for _ in $(seq 60); do
  if docker exec "$DRILL_NAME" pg_isready -h 127.0.0.1 -U postgres -d "$PGDATABASE" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [ "$READY" != '1' ]; then
  echo "Drill Postgres did not accept connections within 60s:" >&2
  docker logs "$DRILL_NAME" >&2 || true
  exit 1
fi

# ── 4. the restore itself — this is the measurement ─────────────────────────
docker cp "$DUMP" "$DRILL_NAME:/tmp/restore.dump"
RESTORE_START=$(now_ms)
# --no-owner: the roles in the dump do not exist in a fresh cluster.
# --no-acl: db/init.sql grants SELECT to invest_app, and roles are cluster-wide,
#   so a single-database dump carries the GRANT but never the CREATE ROLE.
#   Without it every GRANT fails with "role invest_app does not exist".
docker exec -i "$DRILL_NAME" \
  pg_restore --no-owner --no-acl --clean --if-exists \
  -U postgres -d "$PGDATABASE" /tmp/restore.dump
RESTORE_MS=$(( $(now_ms) - RESTORE_START ))

# ── 5. did the data come back ───────────────────────────────────────────────
AFTER=$(drill_psql -tAc "$(control_sql)")
echo "After:  $AFTER"
printf 'Restore time: %d.%03d s (pg_restore only)\n' "$((RESTORE_MS / 1000))" "$((RESTORE_MS % 1000))"
echo "Full drill: ${SECONDS}s (fresh volume → container → restore → verify → cleanup)"

if [ "$BEFORE" != "$AFTER" ]; then
  echo "MISMATCH — the restored database does not match the source." >&2
  exit 1
fi
echo "MATCH"
