import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { Pool } from 'pg';
import { DataSource } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver';
import { Env } from '@/config/env.schema';
import { problem } from '@/shared/problem.exception';
import { VERSION } from '@/shared/version';
import { DbHealthDto, HealthDto } from './dto/health.dto';
import { readiness } from './readiness';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
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

  /** Traffic readiness: red from the first moment of SIGTERM handling. */
  readiness(): HealthDto {
    if (readiness.draining) {
      throw problem(HttpStatus.SERVICE_UNAVAILABLE, 'draining', 'The process is draining');
    }
    return this.liveness();
  }

  /**
   * Readiness — a real round trip to Postgres. After a password rotation this is
   * the request that proves the pool authenticated again with the rotated secret,
   * on the same process.
   */
  async database(): Promise<DbHealthDto> {
    const startedAt = process.hrtime.bigint();

    try {
      const rows: { now: Date; probe_rows: number }[] = await this.dataSource.query(
        'SELECT now() AS now, (SELECT count(*)::int FROM health_probe) AS probe_rows',
      );
      // The app's one pg.Pool — TypeORM's; its counters are what rotation is checked by.
      const pool = (this.dataSource.driver as PostgresDriver).master as Pool;
      const latencyNs = Number(process.hrtime.bigint() - startedAt);

      return {
        status: 'ok',
        latency_ms: Math.round(latencyNs / 1000) / 1000,
        now: new Date(rows[0].now).toISOString(),
        probe_rows: rows[0].probe_rows,
        pool_total: pool.totalCount,
        pool_idle: pool.idleCount,
      };
    } catch (error) {
      // The driver message names the role, the host:port or the absolute path of
      // the secret file. /health/db is unauthenticated, so it stays in the log.
      this.logger.error(`Database query failed: ${(error as Error).message}`);
      throw problem(HttpStatus.SERVICE_UNAVAILABLE, 'db-unavailable', 'The database is unavailable');
    }
  }
}
