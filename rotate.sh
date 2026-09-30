#!/usr/bin/env bash
# Rotates the Postgres password without restarting the app.
#
# The order of the steps matters:
#   1. ALTER ROLE — the new value becomes valid in the database;
#   2. the file, immediately — the gap between (1) and (2) is the only window in
#      which a new connection would still pick up the old password; a zero window
#      needs alternating users (AWS rotation strategies), this is the deliberately
#      simpler single-user scheme;
#   3. pg_terminate_backend — old connections are dropped and the pool opens new
#      ones with the new password (pg reads the file on every new connection);
#   4. the PgBouncer userlist — since homework #15 the app reaches Postgres
#      through a pooler, which authenticates clients against its own copy of the
#      password. Skip this and rotation succeeds while every connection through
#      6432 starts failing.
#
# The app process is never restarted: uptime in /health keeps growing.
set -euo pipefail

cd "$(dirname "$0")"

# Finding the secret file and writing it are shared with init-secret.sh so the
# rule "where the password lives" exists once and cannot drift from what the app
# actually resolves — DB_PASSWORD_FILE is documented as a .env variable, and a
# rotation that writes a file nobody reads locks the app out at step 3.
source scripts/secret-file.sh

SECRET_FILE=$(resolve_secret_file)
DB_NAME=${POSTGRES_DB:-invest}
DB_SUPERUSER=${POSTGRES_USER:-postgres}
APP_ROLE=${APP_DB_ROLE:-invest_app}

psql_super() {
  docker compose exec -T postgres psql -v ON_ERROR_STOP=1 -U "$DB_SUPERUSER" -d "$DB_NAME" "$@"
}

NEW_PASSWORD=$(openssl rand -hex 24)

echo "1/4 ALTER ROLE $APP_ROLE …"
# The statement goes in on stdin rather than in -c: otherwise the new password
# shows up in the argv of `docker compose exec` on the host and of psql in the
# container, where any other process can read it.
psql_super -f - >/dev/null <<SQL
ALTER ROLE $APP_ROLE WITH PASSWORD '$NEW_PASSWORD';
SQL

echo "2/4 updating $SECRET_FILE …"
write_secret "$SECRET_FILE" "$NEW_PASSWORD"

echo "3/4 terminating existing connections of role $APP_ROLE …"
# Terminate and count in one statement: one `docker compose exec` round trip
# instead of two scans of pg_stat_activity.
TERMINATED=$(psql_super -tAc "SELECT count(*) FROM (
  SELECT pg_terminate_backend(pid) FROM pg_stat_activity
  WHERE usename = '$APP_ROLE' AND pid <> pg_backend_pid()) killed;")

echo "4/4 updating the PgBouncer userlist …"
# The repo's pgbouncer/userlist.txt is mounted read-only as userlist.seed.txt and
# copied to the writable auth_file on start, so the rotated value is written into
# the running container only — it never lands in git, exactly like the password
# itself lives in secrets/db_password and not in a tracked file.
#
# SIGHUP and not `RELOAD`: PgBouncer re-reads its auth file on the signal, which
# needs no admin console and no client inside the container. Still no restart.
if [ -n "$(docker compose ps -q pgbouncer 2>/dev/null)" ]; then
  docker compose exec -T pgbouncer \
    sed -i "s|^\"$APP_ROLE\" .*|\"$APP_ROLE\" \"$NEW_PASSWORD\"|" /etc/pgbouncer/userlist.txt
  docker compose kill -s HUP pgbouncer >/dev/null
  echo "    userlist rewritten in the running container, SIGHUP sent"
else
  echo "    pgbouncer is not running — skipped (direct connections to 5433 are unaffected)"
fi

echo "Done: password rotated, connections terminated: ${TERMINATED}. No restart needed."
