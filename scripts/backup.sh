#!/usr/bin/env bash
# Takes a compressed, datestamped pg_dump of the course-project database.
#
#   bash scripts/with-secrets.sh dev bash scripts/backup.sh
#
# The connection comes from the environment (DATABASE_URL, or the DB_* set that
# Infisical injects, or DB_URL + the password file) — see scripts/lib/db-url.sh.
# Homework #15 introduces no new secret and no new env file: the string in the
# vault simply points at PgBouncer now.
#
# Two deliberate choices:
#   * the dump is taken directly from Postgres, never through PgBouncer —
#     pg_dump needs one session holding one snapshot for its entire run, and
#     transaction mode is exactly the promise that a session is not one session;
#   * pg_dump runs inside the postgres container, so the client version always
#     matches the server. A host pg_dump older than the server refuses to run.
#
# Overridable: BACKUP_DIR (default ./backups), BACKUP_KEEP (default 7).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

source "$ROOT/scripts/lib/db-url.sh"
resolve_connection

BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-7}"
mkdir -p "$BACKUP_DIR"

STAMP=$(date +%Y-%m-%d_%H%M%S)
FILE="$BACKUP_DIR/$PGDATABASE-$STAMP.dump"

echo "Backing up $PGDATABASE (role $PGUSER) → $FILE"

# Write to .tmp and rename only on success: an interrupted run must never leave
# something behind that looks like a restorable backup. Same reasoning as
# write_secret() in scripts/secret-file.sh.
if ! db_pg_dump --format=custom --compress=9 > "$FILE.tmp"; then
  rm -f "$FILE.tmp"
  echo "pg_dump failed — no backup written" >&2
  exit 1
fi
mv "$FILE.tmp" "$FILE"

# Keep the directory from growing without bound; the nightly cron entry would
# otherwise fill the disk long before anyone looks at it.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  # shellcheck disable=SC2012
  ls -t "$BACKUP_DIR/$PGDATABASE-"*.dump 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
    echo "Pruning old backup: $old"
    rm -f "$old"
  done
fi

echo "Size: $(du -h "$FILE" | cut -f1)"
echo "Backup: $FILE"
