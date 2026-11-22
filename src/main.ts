// HW #29: tracing first — instrumentations only patch modules loaded after it.
import { otelSdk } from './observability/otel';
import 'reflect-metadata';
import './register-aliases';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Env } from '@/config/env.schema';
import { validateEnv } from '@/config/env.validation';
import { readiness } from '@/health/readiness';
import { logger } from '@/observability/logger';

async function bootstrap(): Promise<void> {
  // Config is validated before anything else is even loaded: src/data-source.ts
  // resolves its connection at import time and would otherwise die first,
  // naming only the database variable instead of every missing secret.
  // process.env wins over .env, exactly as in ConfigModule.
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  validateEnv(process.env);

  const { ConfigService } = await import('@nestjs/config');
  const { createApp } = await import('@/create-app');
  const { setupSwagger } = await import('@/shared/swagger');

  const app = await createApp();
  const config = app.get(ConfigService<Env, true>);

  const port = config.get('PORT', { infer: true });
  setupSwagger(app, port);

  // Both signals go through app.close() (onModuleDestroy drains pg.Pool) and
  // then otelSdk.shutdown(), which ships the spans still sitting in the batch —
  // Nest's own enableShutdownHooks would re-kill the process before that flush.
  // Order matters (HW #28): on SIGTERM readiness goes red first, the Service
  // drops the pod from its endpoints while we keep serving, and only then the
  // socket closes. SIGINT (Ctrl+C) skips the drain.
  const drainMs = config.get('DRAIN_MS', { infer: true });
  const shutdown = (waitMs: number) => () => {
    sleep(waitMs)
      .then(() => app.close())
      .then(() => otelSdk.shutdown())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error(error);
        process.exit(1);
      });
  };
  process.once('SIGINT', shutdown(0));
  process.once('SIGTERM', () => {
    readiness.draining = true;
    logger.info(`SIGTERM: readiness red, draining ${drainMs} ms before close`);
    shutdown(drainMs)();
  });

  // Stand-in for real warmup (migrations, pool): a pod that answered instantly
  // would hide a broken rollout profile.
  await sleep(config.get('STARTUP_DELAY_MS', { infer: true }));

  await app.listen(port);
  logger.info(`invest-api listening on http://localhost:${port}`);
  logger.info(`Swagger UI: http://localhost:${port}/docs · JSON: /docs-json`);
  logger.info(`Swagger UI (uk): http://localhost:${port}/docs/uk · JSON: /docs-json/uk`);
  if (config.get('DRIFT', { infer: true }) === '1') {
    logger.info('DRIFT=1 — the transaction mapper deliberately emits amountCents instead of amount_cents');
  }
}

// Fail-fast: a rejected bootstrap (a broken env variable above all) must end the
// process with a readable message and a non-zero exit code.
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
