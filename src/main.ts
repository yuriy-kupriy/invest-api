import 'reflect-metadata';
import './register-aliases';
import { join } from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from '@/app.module';
import { sendProblem } from '@/shared/problem.format';
import { setupSwagger } from '@/shared/swagger';

async function bootstrap(): Promise<void> {
  const server = express();
  server.use(express.json());
  server.use(
    OpenApiValidator.middleware({
      apiSpec: join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
      ignorePaths: /^\/docs/,
    }),
  );

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
        exposeDefaultValues: true,
      },
    }),
  );

  server.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    sendProblem(err, req, res);
  });

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
