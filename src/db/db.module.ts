import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Env } from '@/config/env.schema';

export const PG_POOL = 'PG_POOL';

const logger = new Logger('Db');

/**
 * Reads the secret from disk. Called by pg for EVERY new connection, so a rotated
 * file is picked up without restarting the process — that is the whole point of
 * keeping the password in a file instead of an environment variable.
 */
function readPassword(passwordFile: string): () => Promise<string> {
  const absolute = resolve(passwordFile);
  return async () => {
    try {
      return (await readFile(absolute, 'utf8')).trim();
    } catch (error) {
      throw new Error(
        `Could not read the secret file ${absolute}: ${(error as Error).message}. ` +
          `Create it with npm run secrets:init.`,
      );
    }
  };
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): Pool => {
        // Discrete fields, not `connectionString`: pg lets a parsed connection
        // string overwrite explicit config, and the password function would be
        // the field it overwrites.
        const url = new URL(config.get('DB_URL', { infer: true }));

        const pool = new Pool({
          host: url.hostname,
          port: Number(url.port || 5432),
          user: decodeURIComponent(url.username),
          database: decodeURIComponent(url.pathname.replace(/^\//, '')),
          password: readPassword(config.get('DB_PASSWORD_FILE', { infer: true })),
          max: config.get('DB_POOL_MAX', { infer: true }),
          connectionTimeoutMillis: config.get('DB_CONNECT_TIMEOUT_MS', { infer: true }),
        });

        // Mandatory. After a rotation `rotate.sh` calls pg_terminate_backend, the
        // idle clients die, and the pool emits 'error' on them; with no listener
        // that is an unhandled 'error' event and the process exits. This is not a
        // rotation bug — it is the missing handler.
        pool.on('error', (error) => {
          logger.warn(`Database connection dropped: ${error.message} — the pool will open a new one`);
        });

        return pool;
      },
    },
  ],
  exports: [PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
