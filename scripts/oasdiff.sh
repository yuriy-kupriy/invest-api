#!/usr/bin/env bash
# HW #32 contract gate: `oasdiff breaking <base> <revision> --fail-on ERR`.
# Exit ≠ 0 when the revision breaks a client of the base (a removed path, a new
# required field, a narrowed type…). Same call in CI and in demo:gates.
# A local `oasdiff` binary wins; otherwise the pinned image (digest, not tag).
#
#   bash scripts/oasdiff.sh <base.yaml> <revision.yaml>
set -euo pipefail
[ "$#" -eq 2 ] || { echo "usage: scripts/oasdiff.sh <base> <revision>" >&2; exit 2; }
IMAGE='tufin/oasdiff:v1.34.1@sha256:67a23cfea7d251e2ae34ee703ac8733c5d96bc2e7b90fd0f4d475ec99367b85f'

if command -v oasdiff >/dev/null 2>&1; then
  exec oasdiff breaking "$1" "$2" --fail-on ERR
fi
base=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
rev=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
exec docker run --rm -v "$base:/spec/base.yaml:ro" -v "$rev:/spec/revision.yaml:ro" \
  "$IMAGE" breaking /spec/base.yaml /spec/revision.yaml --fail-on ERR
