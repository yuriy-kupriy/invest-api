#!/usr/bin/env bash
# HW #32: how many times does a value of an app secret appear in <file>?
# Runs under scripts/with-secrets.sh, so the values are in the environment; it
# prints ONLY the number. The grader cannot do this search (it has no values),
# so the pipeline does it where the values are and ships the count.
#
#   bash scripts/with-secrets.sh dev bash scripts/secret-count.sh deployment.json
set -euo pipefail
FILE=${1:?usage: secret-count.sh <file>}
[ -r "$FILE" ] || { echo "secret-count: cannot read $FILE" >&2; exit 2; }
# Same names as VAULT_VARS in infra/index.ts, plus the state passphrase.
NAMES=(DB_URL DB_PASSWORD JWT_KID JWT_PRIVATE_KEY JWT_PUBLIC_KEY REFRESH_TOKEN_PEPPER
       STORAGE_REGION STORAGE_BUCKET STORAGE_ACCESS_KEY STORAGE_SECRET_KEY PULUMI_CONFIG_PASSPHRASE)
total=0
for n in "${NAMES[@]}"; do
  v=${!n:-}
  # shortcut: values under 8 chars are skipped (false hits on common words); vault values are longer.
  [ "${#v}" -ge 8 ] || continue
  # grep exits 1 on zero hits, which is the good case; the file was checked above
  c=$( { grep -oF -- "$v" "$FILE" || true; } | wc -l | tr -d ' ')
  total=$(( total + c ))
done
echo "$total"
