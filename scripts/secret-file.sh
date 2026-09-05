# Shared by rotate.sh and scripts/init-secret.sh. Both cd to the repo root first,
# so sourcing looks the same in each: source scripts/secret-file.sh
#
# One copy of the two rules that must agree with the running app:
#   * where the secret file is (DB_PASSWORD_FILE from the environment, then from
#     .env, then the schema default) — precedence matches @nestjs/config;
#   * how it is written (temp file + mv, so the swap is atomic and a concurrent
#     connection never reads a half-written password).

env_file_value() {
  [[ -f .env ]] || return 0
  sed -n "s/^[[:space:]]*$1=//p" .env | tail -n 1 | sed -e 's/^['"'"'"]//' -e 's/['"'"'"]$//'
}

resolve_secret_file() {
  local path=${DB_PASSWORD_FILE:-$(env_file_value DB_PASSWORD_FILE)}
  printf '%s' "${path:-./secrets/db_password}"
}

write_secret() {
  local target=$1 value=$2
  mkdir -p "$(dirname "$target")"
  printf '%s' "$value" > "$target.tmp"
  chmod 600 "$target.tmp"
  mv "$target.tmp" "$target"
}
