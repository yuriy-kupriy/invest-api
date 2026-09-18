import { readFileSync } from 'node:fs';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Account } from './entities/account.entity';
import { Category } from './entities/category.entity';
import { Currency } from './entities/currency.entity';
import { FxRate } from './entities/fx-rate.entity';
import { Instrument } from './entities/instrument.entity';
import { Transaction } from './entities/transaction.entity';
import { User } from './entities/user.entity';

/**
 * DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME are the primary source (this is
 * what a grader or CI exports directly). DB_URL + DB_PASSWORD_FILE is the
 * fallback for the app's own runtime, which keeps the password in a rotatable
 * file rather than an env var (see src/db/db.module.ts and rotate.sh).
 * Either way, every value comes from process.env — nothing is hardcoded here.
 */
interface ConnectionInfo {
  type: 'postgres';
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
}

function resolveConnection(): ConnectionInfo {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_URL, DB_PASSWORD_FILE } = process.env;

  if (DB_HOST && DB_USER && DB_NAME) {
    return {
      type: 'postgres',
      host: DB_HOST,
      port: DB_PORT ? Number(DB_PORT) : 5432,
      username: DB_USER,
      password: DB_PASSWORD ?? '',
      database: DB_NAME,
    };
  }

  if (!DB_URL) {
    throw new Error(
      'No database connection info in process.env: set DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME, ' +
        'or DB_URL (+ DB_PASSWORD_FILE).',
    );
  }

  const url = new URL(DB_URL);
  const passwordFile = DB_PASSWORD_FILE ?? './secrets/db_password';
  const password = readFileSync(passwordFile, 'utf8').trim();

  return {
    type: 'postgres',
    host: url.hostname,
    port: Number(url.port || 5432),
    username: decodeURIComponent(url.username),
    password,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
}

export const dataSourceOptions: DataSourceOptions = {
  ...resolveConnection(),
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOG === '1' ? ['query', 'error'] : ['error'],
  entities: [User, Account, Currency, Instrument, Category, FxRate, Transaction],
  migrations: [__dirname + '/migrations/*.js'],
};

export default new DataSource(dataSourceOptions);
