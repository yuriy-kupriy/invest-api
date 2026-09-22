import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { Account } from '../../src/entities/account.entity';
import { Category } from '../../src/entities/category.entity';
import { Currency } from '../../src/entities/currency.entity';
import { FxRate } from '../../src/entities/fx-rate.entity';
import { Instrument } from '../../src/entities/instrument.entity';
import { Job } from '../../src/entities/job.entity';
import { Transaction } from '../../src/entities/transaction.entity';
import { User } from '../../src/entities/user.entity';
import { InitSchema1789217422599 } from '../../src/migrations/1789217422599-InitSchema';
import { AccountCurrencyGuard1789230000000 } from '../../src/migrations/1789230000000-AccountCurrencyGuard';
import { TransactionsAccountBookedIndexCovering1789240000000 } from '../../src/migrations/1789240000000-TransactionsAccountBookedIndexCovering';
import { TimestampMillisecondPrecision1789250000000 } from '../../src/migrations/1789250000000-TimestampMillisecondPrecision';
import { FxRatePrimaryKeyCurrencyFirst1789260000000 } from '../../src/migrations/1789260000000-FxRatePrimaryKeyCurrencyFirst';
import { JobQueue1789922194647 } from '../../src/migrations/1789922194647-JobQueue';

const ENTITIES = [User, Account, Currency, Instrument, Category, FxRate, Transaction, Job];

/**
 * Explicit classes, not the `__dirname + '/migrations/*.js'` glob that
 * src/data-source.ts uses: under ts-jest `__dirname` is `src/` and there is no
 * compiled `.js` there, so the glob would silently apply zero migrations and
 * every integration test would fail on a missing table.
 */
const MIGRATIONS = [
  InitSchema1789217422599,
  AccountCurrencyGuard1789230000000,
  TransactionsAccountBookedIndexCovering1789240000000,
  TimestampMillisecondPrecision1789250000000,
  FxRatePrimaryKeyCurrencyFirst1789260000000,
  JobQueue1789922194647,
];

/** Every table the suites write to, ordered for readability — CASCADE does the real work. */
const TABLES = 'transactions, accounts, instruments, categories, fx_rate, job_queue, users, currency';

export async function startPg(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('invest')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();
}

/**
 * Hands the running container to everything that reads connection info from
 * process.env — TypeORM via the discrete DB_HOST/... branch of
 * resolveConnection(), and the pg.Pool in src/db/db.module.ts via
 * DB_URL + DB_PASSWORD_FILE.
 *
 * DB_URL is written WITHOUT the password on purpose: envSchema refuses a URL
 * that carries one (the password belongs in a file so rotation needs no
 * restart), and container.getConnectionUri() includes it.
 */
export function applyEnv(container: StartedPostgreSqlContainer): void {
  const passwordFile = join(tmpdir(), `invest-api-test-db-password-${randomUUID()}`);
  writeFileSync(passwordFile, container.getPassword(), { mode: 0o600 });

  process.env.DB_HOST = container.getHost();
  process.env.DB_PORT = String(container.getPort());
  process.env.DB_USER = container.getUsername();
  process.env.DB_PASSWORD = container.getPassword();
  process.env.DB_NAME = container.getDatabase();

  process.env.DB_URL = `postgres://${container.getUsername()}@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.DB_PASSWORD_FILE = passwordFile;

  process.env.NODE_ENV = 'test';
  process.env.DRIFT = '0';
  process.env.FX_SYNC_ON_START = '0';
}

/** A standalone DataSource for schema work and assertions, separate from Nest's. */
export async function connect(): Promise<DataSource> {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    entities: ENTITIES,
    migrations: MIGRATIONS,
    synchronize: false,
    migrationsRun: false,
    logging: ['error'],
  });
  await ds.initialize();
  return ds;
}

/**
 * The reference rows every suite starts from: db/dev-fixtures.sql (the same
 * accounts and transactions the e2e suite hardcodes) plus the USD fx rates the
 * Cache-Control case reads, which the fixture file does not carry.
 */
export async function seedFixtures(ds: DataSource): Promise<void> {
  await ds.query(readFileSync(resolve(__dirname, '../../db/dev-fixtures.sql'), 'utf8'));
  await ds.query(`
    INSERT INTO fx_rate (currency, rate_date, source, raw_rate, raw_units) VALUES
      ('USD', DATE '2026-01-15', 'seed', 41.5, 1),
      ('USD', DATE '2026-08-21', 'seed', 41.5, 1)
    ON CONFLICT DO NOTHING;
  `);
}

export async function truncateAll(ds: DataSource): Promise<void> {
  await ds.query(`TRUNCATE ${TABLES} RESTART IDENTITY CASCADE`);
}

/** Wipe, then re-seed — the whole isolation strategy in one call. */
export async function resetDb(ds: DataSource): Promise<void> {
  await truncateAll(ds);
  await seedFixtures(ds);
}

declare global {
  // eslint-disable-next-line no-var
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Runs in Jest's parent process. Workers are forked afterwards and inherit
 * process.env, which is the only reason a container started here is reachable
 * from a test file's top-level `import '@/data-source'` — that module resolves
 * its connection at import time and throws on an empty env.
 */
export async function setupGlobal(): Promise<void> {
  const container = await startPg();
  globalThis.__PG_CONTAINER__ = container;
  applyEnv(container);

  const ds = await connect();
  await ds.runMigrations();
  await seedFixtures(ds);
  await ds.destroy();
}

export async function teardownGlobal(): Promise<void> {
  await globalThis.__PG_CONTAINER__?.stop();
  globalThis.__PG_CONTAINER__ = undefined;
}
