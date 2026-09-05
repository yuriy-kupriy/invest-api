-- Runs once, when the pgdata volume is first created.
-- NOTE: the password below is the initial value and must match what
-- scripts/init-secret.sh writes. After `docker compose down -v` Postgres falls
-- back to it while the secret file keeps the rotated one, so restore the file:
-- FORCE=1 npm run secrets:init.
CREATE ROLE invest_app WITH LOGIN PASSWORD 'dev_local_password';

GRANT CONNECT ON DATABASE invest TO invest_app;
GRANT USAGE ON SCHEMA public TO invest_app;

-- One row of real data, so /health/db actually reads a table instead of only
-- running SELECT now().
CREATE TABLE health_probe (
  id          smallint PRIMARY KEY,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO health_probe (id) VALUES (1);

GRANT SELECT ON health_probe TO invest_app;
