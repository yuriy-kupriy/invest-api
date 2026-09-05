import 'reflect-metadata';
import './register-aliases';
import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env.schema';
import { createApp } from '@/create-app';
import { setupSwagger } from '@/shared/swagger';

async function bootstrap(): Promise<void> {
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
