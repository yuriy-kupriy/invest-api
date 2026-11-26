#!/usr/bin/env bash
# Course project: the whole main contour in Docker with one command.
#   npm run compose:up    → infra + migrate + seed + api + relay + consumer, waits until healthy
#   npm run compose:down  → stops everything and drops the volumes
#
# Secrets are generated locally on first run into .compose/ (gitignored) — no
# vault access, no manual exports, and nothing secret lands in git or the image:
#   env          JWT ES256 pair, refresh pepper, webhook key, reviewer password
#   db_password  the compose Postgres dev password, mounted as a file secret
#   npm_token    the BuildKit build-secret decoy the Dockerfile requires (HW #28)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .compose/env ]; then
  mkdir -p .compose
  node -e '
const { generateKeyPairSync, randomBytes } = require("node:crypto");
const k = generateKeyPairSync("ec", { namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" } });
const b64 = (s) => Buffer.from(s).toString("base64");
const rnd = () => randomBytes(18).toString("base64url");
require("node:fs").writeFileSync(".compose/env", [
  "JWT_KID=compose-" + rnd().slice(0, 8),
  "JWT_PRIVATE_KEY=" + b64(k.privateKey),
  "JWT_PUBLIC_KEY=" + b64(k.publicKey),
  "REFRESH_TOKEN_PEPPER=" + rnd(),
  "TRADE_WEBHOOK_SECRET=" + rnd(),
  "DEV_USER_PASSWORD=" + rnd(),
].join("\n") + "\n", { mode: 0o644 });'
  printf 'postgres' > .compose/db_password   # the dev superuser password from docker-compose.yml, not a secret
  printf 'compose-decoy-token' > .compose/npm_token
  echo "compose-up: generated .compose/env (reviewer password: grep DEV_USER_PASSWORD .compose/env)"
fi

docker compose --profile app up -d --wait --build
echo "compose-up: API on http://localhost:${API_HOST_PORT:-3000} · Swagger /docs · run: npm run demo:contour"
