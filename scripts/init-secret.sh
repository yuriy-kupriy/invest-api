#!/usr/bin/env bash
# Writes the initial password into the secret file when the file is missing.
# The value must match db/init.sql, otherwise after `docker compose down -v`
# (Postgres falls back to the initial password while the file keeps the rotated
# one) the app hits "password authentication failed".
set -euo pipefail

cd "$(dirname "$0")/.."

source scripts/secret-file.sh

SECRET_FILE=$(resolve_secret_file)

# Read from db/init.sql instead of keeping a second copy here: that file is the
# only place Postgres actually receives the value, and two copies kept in sync by
# a comment is exactly the drift the README documents as a trap.
INITIAL_PASSWORD=$(sed -n "s/.*CREATE ROLE invest_app WITH LOGIN PASSWORD '\([^']*\)'.*/\1/p" db/init.sql)
if [[ -z "$INITIAL_PASSWORD" ]]; then
  echo "No initial password found in db/init.sql — check the CREATE ROLE there" >&2
  exit 1
fi

if [[ -f "$SECRET_FILE" && "${FORCE:-0}" != '1' ]]; then
  echo "$SECRET_FILE already exists — leaving it alone (FORCE=1 to overwrite with the initial password)"
  exit 0
fi

write_secret "$SECRET_FILE" "$INITIAL_PASSWORD"
echo "Wrote the initial password to $SECRET_FILE"
