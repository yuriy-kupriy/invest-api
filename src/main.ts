import 'reflect-metadata';
import './register-aliases';
import { createApp } from '@/create-app';
import { setupSwagger } from '@/shared/swagger';

async function bootstrap(): Promise<void> {
  const app = await createApp();

  const port = Number(process.env.PORT ?? 3000);
  setupSwagger(app, port);

  await app.listen(port);
  console.log(`invest-api listening on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/docs · JSON: /docs-json`);
  console.log(`Swagger UI (uk): http://localhost:${port}/docs/uk · JSON: /docs-json/uk`);
  if (process.env.DRIFT === '1') {
    console.log('DRIFT=1 — мапер транзакції навмисно віддає amountCents замість amount_cents');
  }
}

void bootstrap();
