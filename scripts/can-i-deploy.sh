#!/usr/bin/env bash
# Usage: scripts/can-i-deploy.sh <pacticipant> <version> [to-environment-tag]
#
# Asks the broker whether that version has a verified contract against whatever
# is currently tagged `prod`, and fails the build when the answer is anything
# other than a definite yes. "unknown" is not a yes: before any provider version
# carries the tag, the broker has nothing to compare against and says so.
#
# PACT_BROKER_URL / PACT_BROKER_TOKEN come from the environment — the vault
# wrapper locally (scripts/with-secrets.sh), GitHub secrets in CI. Never from a
# constant in this file.
set -euo pipefail

PACTICIPANT="${1:?usage: can-i-deploy.sh <pacticipant> <version> [to]}"
VERSION="${2:?usage: can-i-deploy.sh <pacticipant> <version> [to]}"
TO="${3:-prod}"
BROKER="${PACT_BROKER_URL:-http://127.0.0.1:9292}"

# `set -u` treats an empty array expansion as unbound on bash 3 (macOS), so
# the header is built as a single string and only passed when it has a value.
AUTH_HEADER=""
if [ -n "${PACT_BROKER_TOKEN:-}" ]; then
  AUTH_HEADER="Authorization: Bearer ${PACT_BROKER_TOKEN}"
fi

URL="${BROKER}/can-i-deploy?pacticipant=${PACTICIPANT}&version=${VERSION}&to=${TO}"
if [ -n "$AUTH_HEADER" ]; then
  RESPONSE="$(curl -sS -H "$AUTH_HEADER" "$URL")"
else
  RESPONSE="$(curl -sS "$URL")"
fi

echo "$RESPONSE"

node -e '
const r = JSON.parse(process.argv[1]);
const s = r.summary ?? {};
if (s.deployable === true) process.exit(0);
console.error(`can-i-deploy: NOT deployable (deployable=${s.deployable}, unknown=${s.unknown}, failed=${s.failed})`);
process.exit(1);
' "$RESPONSE"
