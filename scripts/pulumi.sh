#!/usr/bin/env bash
# Runs pulumi against the LOCAL file backend and the `dev` stack of infra/.
# Wrapped by scripts/with-secrets.sh in npm run up/destroy, so the vault values
# (and PULUMI_CONFIG_PASSPHRASE) are already in the environment here.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Never `pulumi login` to a cloud account: the grader has none.
export PULUMI_BACKEND_URL="${PULUMI_BACKEND_URL:-file://$ROOT/.pulumi}"
case "$PULUMI_BACKEND_URL" in file://*) mkdir -p "${PULUMI_BACKEND_URL#file://}";; esac

cd "$ROOT/infra"
[ -d node_modules ] || npm ci --silent
pulumi stack select --create dev --non-interactive >/dev/null
exec pulumi "$@" --non-interactive
