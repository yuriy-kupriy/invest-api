#!/usr/bin/env bash
# HW #28 scan gate. The verdict is COMPUTED: trivy writes a JSON report, node
# counts the findings, the shell compares the count with SCAN_MAX. Nothing here
# prints a fixed verdict — SCAN_MAX=-1 must fail and SCAN_MAX=99999 must pass.
#
#   SCAN_MAX=<n> IMAGE=<ref> SEVERITY=<list> npm run scan
set -euo pipefail

IMAGE="${IMAGE:-invest-api:hw28}"
SEVERITY="${SEVERITY:-CRITICAL,HIGH}"
# Working threshold: the fixable CRITICAL+HIGH count measured when this was
# written (7 in the distroless libssl3, 23 in npm deps; README ## Kubernetes). The trivy DB updates daily,
# so this is a ceiling to keep from growing, not a promise of zero.
MAX="${SCAN_MAX:-30}"

REPORT=$(mktemp)
trap 'rm -f "$REPORT"' EXIT

trivy image --quiet --severity "$SEVERITY" --ignore-unfixed --format json --output "$REPORT" "$IMAGE"

FOUND=$(node -e '
const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log((r.Results || []).reduce((n, x) => n + (x.Vulnerabilities || []).length, 0));
' "$REPORT")

echo "image=$IMAGE"
echo "severity=$SEVERITY"
echo "found=$FOUND"
echo "max-allowed=$MAX"
if [ "$FOUND" -le "$MAX" ]; then
  echo "gate=pass"
else
  echo "gate=fail"
  exit 1
fi
