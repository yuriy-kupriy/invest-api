#!/usr/bin/env bash
# HW #28 demo:image — every number is measured from the built image, not from
# reading the Dockerfile (except `stages`, which IS a property of the Dockerfile).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IMAGE="${IMAGE:-invest-api:hw28}"
TOKEN_FILE="${TOKEN_FILE:-.npm_token}"
[ -s "$TOKEN_FILE" ] || { echo "$TOKEN_FILE is missing or empty — it is the build secret to look for" >&2; exit 1; }
TOKEN=$(cat "$TOKEN_FILE")
docker image inspect "$IMAGE" >/dev/null || { echo "no image $IMAGE — npm run image:build" >&2; exit 1; }

echo "image=$IMAGE"
echo "stages=$(grep -ciE '^[[:space:]]*FROM[[:space:]]' docker/Dockerfile)"

# Run it: a base inherited from someone else's image could carry a shell
# nobody wrote into this Dockerfile.
if docker run --rm --entrypoint sh "$IMAGE" -c true >/dev/null 2>&1 \
  || docker run --rm --entrypoint /bin/sh "$IMAGE" -c true >/dev/null 2>&1; then
  echo "shell-inside=1"
else
  echo "shell-inside=0"
fi

# The uid the process really gets, asked from inside the running container.
uid=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" -e 'console.log(process.getuid())' 2>/dev/null \
  || docker run --rm --entrypoint node "$IMAGE" -e 'console.log(process.getuid())' 2>/dev/null || true)
echo "runtime-uid=$uid"

# Three channels, because no single tool sees both leaks:
#  ARG       -> image metadata (history / config), not layer bytes;
#  COPY + rm -> layer bytes (whiteout hides it from the final FS), not metadata.
echo "token-in-history=$(docker history --no-trunc "$IMAGE" | grep -cF -- "$TOKEN" || true)"
echo "token-in-config=$(docker image inspect "$IMAGE" | grep -cF -- "$TOKEN" || true)"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
docker save "$IMAGE" -o "$WORK/image.tar"
mkdir "$WORK/x"
tar -xf "$WORK/image.tar" -C "$WORK/x"
hits=0
# Every file of the saved image: layer tars (gzipped or not), configs, manifests.
while IFS= read -r -d '' f; do
  if gzip -t "$f" 2>/dev/null; then
    gzip -dc "$f" | grep -qaF -- "$TOKEN" && hits=$((hits + 1))
  else
    grep -qaF -- "$TOKEN" "$f" && hits=$((hits + 1))
  fi
done < <(find "$WORK/x" -type f -print0)
echo "token-in-layers=$hits"
