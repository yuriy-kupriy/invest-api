#!/usr/bin/env bash
# Snapshot of the NBU rates in fx_rate as a CSV in git, so a fresh environment
# loads the history with one command and the startup sync only fetches the days
# after it. Talks to the compose Postgres as the superuser, like db:fixtures.
#
#   dump — fx_rate (source 'nbu') → db/fx-rates-nbu.csv. Start the app once with
#          FX_SYNC_ON_START=1 first, so the table has the history.
#   load — db/fx-rates-nbu.csv → fx_rate, ON CONFLICT DO NOTHING: never
#          overwrites a newer correction a sync already stored. Needs the
#          currency rows (npm run seed or db:fixtures) — the FK fails otherwise.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CSV="$ROOT/db/fx-rates-nbu.csv"
PSQL=(docker compose -f "$ROOT/docker-compose.yml" exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -q)

case "${1:-}" in
  dump)
    # Columns lead with what a human scans for (date, currency, the actual
    # rate) before the raw_rate/raw_units it's derived from and the source.
    # `rate` itself is GENERATED in fx_rate (raw_rate/raw_units), so it rides
    # along here for readability only — load() below re-derives nothing from
    # it and never writes it back. trim_scale: numeric(20,10) would print ten
    # decimals; keep NBU's own digits instead.
    # Ordered by date first: every future refresh only ever appends newer dates
    # (the sync never rewrites old history), so under this order the new rows
    # land in one contiguous block at the end of the file — a single clean git
    # diff — instead of scattered across all 40 currencies' own blocks.
    "${PSQL[@]}" -c "COPY (
        SELECT rate_date, currency, trim_scale(rate) AS rate,
               trim_scale(raw_rate) AS raw_rate, raw_units, source
          FROM fx_rate WHERE source = 'nbu'
         ORDER BY rate_date, currency
      ) TO STDOUT WITH (FORMAT csv, HEADER)" > "$CSV"
    rows=$(($(wc -l < "$CSV") - 1))
    if [ "$rows" -le 0 ]; then
      echo "no 'nbu' rows in fx_rate — start the app with FX_SYNC_ON_START=1 first" >&2
      exit 1
    fi
    echo "wrote $rows rows to db/fx-rates-nbu.csv"
    ;;
  load)
    # One psql session: the -c commands share the temp table and the transaction,
    # and COPY ... FROM STDIN reads the CSV piped into psql. The staging table
    # mirrors the CSV's columns 1:1 (rate included); the INSERT below picks
    # only what fx_rate actually stores — `rate` is GENERATED there, so it's
    # read from the file but never written.
    "${PSQL[@]}" \
      -c "BEGIN" \
      -c "CREATE TEMP TABLE fx_rate_staging (rate_date date, currency text, rate numeric, raw_rate numeric, raw_units int, source text)" \
      -c "COPY fx_rate_staging FROM STDIN WITH (FORMAT csv, HEADER)" \
      -c "INSERT INTO fx_rate (source, currency, rate_date, raw_rate, raw_units)
            SELECT source, currency, rate_date, raw_rate, raw_units FROM fx_rate_staging
          ON CONFLICT (source, currency, rate_date) DO NOTHING" \
      -c "COMMIT" < "$CSV"
    echo "loaded db/fx-rates-nbu.csv"
    ;;
  *)
    echo "usage: $0 dump|load" >&2
    exit 2
    ;;
esac
