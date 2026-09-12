import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { Env } from '@/config/env.schema';
import { PG_POOL } from '@/db/db.module';
import { problem } from '@/shared/problem.exception';
import { VERSION } from '@/shared/version';
import { DbHealthDto, HealthDto } from './dto/health.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Liveness only — deliberately does not touch the database, so `uptime_seconds`
   * stays a clean answer to one question: did this process restart?
   */
  liveness(): HealthDto {
    return {
      status: 'ok',
      uptime_seconds: Math.round(process.uptime() * 1000) / 1000,
      version: VERSION,
      node_env: this.config.get('NODE_ENV', { infer: true }),
    };
  }

  /**
   * Readiness — a real round trip to Postgres. After a password rotation this is
   * the request that proves the pool authenticated again with the rotated secret,
   * on the same process.
   */
  async database(): Promise<DbHealthDto> {
    const startedAt = process.hrtime.bigint();

    try {
      const { rows } = await this.pool.query<{ now: Date; probe_rows: number }>(
        'SELECT now() AS now, (SELECT count(*)::int FROM health_probe) AS probe_rows',
      );
      const latencyNs = Number(process.hrtime.bigint() - startedAt);

      return {
        status: 'ok',
        latency_ms: Math.round(latencyNs / 1000) / 1000,
        now: new Date(rows[0].now).toISOString(),
        probe_rows: rows[0].probe_rows,
        pool_total: this.pool.totalCount,
        pool_idle: this.pool.idleCount,
      };
    } catch (error) {
      // The driver message names the role, the host:port or the absolute path of
      // the secret file. /health/db is unauthenticated, so it stays in the log.
      this.logger.error(`Database query failed: ${(error as Error).message}`);
      throw problem(HttpStatus.SERVICE_UNAVAILABLE, 'db-unavailable', 'The database is unavailable');
    }
  }
}
