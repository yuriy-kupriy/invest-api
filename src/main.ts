import 'reflect-metadata';
import './register-aliases';
import { existsSync } from 'node:fs';
import type { Env } from '@/config/env.schema';
import { validateEnv } from '@/config/env.validation';

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

  // Without this SIGTERM kills the process outright: onModuleDestroy never runs,
  // so pg.Pool.end() never drains and Postgres keeps the abandoned backends.
  app.enableShutdownHooks();

  await app.listen(port);
  console.log(`invest-api listening on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/docs · JSON: /docs-json`);
  console.log(`Swagger UI (uk): http://localhost:${port}/docs/uk · JSON: /docs-json/uk`);
  if (config.get('DRIFT', { infer: true }) === '1') {
    console.log('DRIFT=1 — the transaction mapper deliberately emits amountCents instead of amount_cents');
  }
}

// Fail-fast: a rejected bootstrap (a broken env variable above all) must end the
// process with a readable message and a non-zero exit code.
bootstrap().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
