# Shared by scripts/backup.sh and scripts/restore-drill.sh. Both cd to the repo
# root first, so sourcing looks the same in each: source scripts/lib/db-url.sh
#
# One place where PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE come from, with the
# same precedence the application itself uses (src/data-source.ts):
#
#   1. DATABASE_URL          — what the grader exports (README ## Grading);
#   2. DB_HOST/DB_USER/DB_NAME — what Infisical injects through
#                                scripts/with-secrets.sh (homework #11);
#   3. DB_URL + DB_PASSWORD_FILE — the application's own runtime contract, where
#                                the password is a file so it can be rotated.
#
# Nothing here reads a new env file: homework #15 adds no new secret, only a new
# value (the PgBouncer host/port) for the one that already exists in the vault.

# percent-decoding, because a URL may carry an escaped password or database name
urldecode() {
  printf '%b' "${1//%/\\x}"
}

resolve_connection() {
  local url=''

  if [ -n "${DATABASE_URL:-}" ]; then
    url="$DATABASE_URL"
  elif [ -n "${DB_HOST:-}" ] && [ -n "${DB_USER:-}" ] && [ -n "${DB_NAME:-}" ]; then
    PGHOST="$DB_HOST"
    PGPORT="${DB_PORT:-5432}"
    PGUSER="$DB_USER"
    PGPASSWORD="${DB_PASSWORD:-}"
    PGDATABASE="$DB_NAME"
    export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
    return 0
  elif [ -n "${DB_URL:-}" ]; then
    url="$DB_URL"
    # The application keeps the password out of the URL on purpose; it lives in
    # a file that rotate.sh rewrites.
    PGPASSWORD=$(tr -d '\n' < "${DB_PASSWORD_FILE:-./secrets/db_password}")
  else
    # Exactly the failure a fresh clone with no vault access must produce, and
    # the one the README tells the grader to fix with two exports.
    echo "DATABASE_URL: unbound variable" >&2
    echo "  Set DATABASE_URL (or DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME, or DB_URL)." >&2
    echo "  See the '## Grading' section of README.md." >&2
    exit 1
  fi

  # postgres://user[:password]@host[:port]/database
  if [[ ! "$url" =~ ^postgres(ql)?://(([^:@/]+)(:([^@/]*))?@)?([^:@/]+)(:([0-9]+))?/(.+)$ ]]; then
    echo "Not a postgres:// connection string: $url" >&2
    exit 1
  fi

  PGUSER=$(urldecode "${BASH_REMATCH[3]}")
  [ -n "${BASH_REMATCH[5]}" ] && PGPASSWORD=$(urldecode "${BASH_REMATCH[5]}")
  PGHOST="${BASH_REMATCH[6]}"
  PGPORT="${BASH_REMATCH[8]:-5432}"
  PGDATABASE=$(urldecode "${BASH_REMATCH[9]%%\?*}")

  : "${PGPASSWORD:=}"
  export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE
}

# Is the compose Postgres service running? Everything below prefers to run the
# client binaries inside it, for one concrete reason: the client must not be
# older than the server. A host pg_dump 13 against a server 16 aborts outright
# ("server version mismatch"), and that is the version pair on the machine this
# homework was written on. Inside the container the binaries always match.
compose_postgres_running() {
  local id
  id=$(docker compose -f "$ROOT/docker-compose.yml" ps -q postgres 2>/dev/null) || return 1
  [ -n "$id" ] || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$id" 2>/dev/null)" = 'true' ]
}

# psql against the live database. In the container it goes over the local socket
# (the official image trusts it — rotate.sh has relied on that since #2), so the
# connection string contributes the role and the database name, not the route.
db_psql() {
  if compose_postgres_running; then
    docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
      psql -v ON_ERROR_STOP=1 -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    psql -v ON_ERROR_STOP=1 -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}

# Same rule for pg_dump, plus one of its own: a dump must never go through the
# pooler. pg_dump wants one session with one snapshot for its whole run, which
# is precisely what transaction mode does not promise.
db_pg_dump() {
  if compose_postgres_running; then
    docker compose -f "$ROOT/docker-compose.yml" exec -T postgres \
      pg_dump -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  fi
}
