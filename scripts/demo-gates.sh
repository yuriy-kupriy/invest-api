#!/usr/bin/env bash
# HW #32 demo:gates — every quality gate of the pipeline, run twice with the SAME
# tool: once on the correct input (<step>-ok must be 0) and once on a deliberately
# broken one (<step>-broken must be ≠ 0). Exit codes are captured, not printed
# constants; a gate that cannot fail would show <step>-broken=0 here.
#
#   npm run demo:gates          # needs: docker (oasdiff), trivy + invest-api:hw28 (scan, as in #28)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
F=gates/fixtures
OUT=$(mktemp)
trap 'rm -f "$OUT"' EXIT

# run <key> <command…>: tool output goes to stderr-side log, only the code is the verdict.
run() {
  local key=$1; shift
  "$@" >"$OUT" 2>&1
  local rc=$?
  echo "$key=$rc"
  [ "$rc" -ne 0 ] && sed 's/^/    | /' "$OUT" | tail -4 >&2
  return 0
}

# 1. Types & style: tsc + eslint on the project / on a typo.
types_ok()     { npx tsc --noEmit && npx eslint src; }
types_broken() { npx tsc --noEmit --strict "$F/types-broken.ts"; }
run types-ok types_ok
run types-broken types_broken

# 2. Contract: the spec against itself / against a copy with a removed path.
run contract-ok bash scripts/oasdiff.sh openapi/openapi.yaml openapi/openapi.yaml
run contract-broken bash scripts/oasdiff.sh openapi/openapi.yaml "$F/openapi-broken.yaml"

# 3. Architecture: the real src/ / a domain file importing a controller.
run arch-ok npx depcruise src --config .dependency-cruiser.cjs
run arch-broken npx depcruise "$F/arch/src" --config .dependency-cruiser.cjs

# 4. Image: the #28 scan gate unchanged; only the threshold differs.
run image-ok env SCAN_MAX=99999 bash scripts/scan.sh
run image-broken env SCAN_MAX=-1 bash scripts/scan.sh
