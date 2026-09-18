#!/usr/bin/env bash
# Runs its arguments with Infisical-managed secrets (DB_HOST/DB_PORT/DB_USER/
# DB_PASSWORD/DB_NAME, ...) loaded into the environment. Every npm script that
# talks to the database is wrapped in this: `bash scripts/with-secrets.sh dev …`.
#
# Usage: scripts/with-secrets.sh <env-slug> <command...>
#   scripts/with-secrets.sh dev npm run start
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_SLUG="${1:-dev}"; shift || true

[ "$#" -gt 0 ] || set -- npm run start

# грейдер не має доступу до сховища: значення вже в оточенні
if [ "${SKIP_VAULT:-0}" = "1" ]; then exec "$@"; fi

CREDS="$ROOT/.secrets/infisical.env"

if ! command -v infisical >/dev/null 2>&1; then
  echo "infisical CLI not found on PATH. Install it (https://infisical.com/docs/cli/overview)" >&2
  echo "or set SKIP_VAULT=1 with DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME already exported." >&2
  exit 1
fi

if [ ! -f "$CREDS" ]; then
  echo "Missing $CREDS — copy .secrets/infisical.env.example, fill in your project/client" >&2
  echo "credentials for 'infisical login', or set SKIP_VAULT=1 (see README ## Grading)." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$CREDS"
set +a

exec infisical run --env="$ENV_SLUG" -- "$@"
