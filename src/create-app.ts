import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from '@/app.module';
import { sendProblem } from '@/shared/problem.format';

export interface CreateAppOptions {
  /** Set to false to silence Nest's built-in logger — useful in tests. */
  logger?: boolean;
}

/**
 * Builds the Nest application wired to the raw Express instance: request/response
 * validation against openapi/openapi.yaml, the Idempotency-Key middleware and the
 * problem+json error handler. Shared by main.ts (real listen()) and the e2e suite
 * (supertest talks to the same pipeline without binding a port).
 */
export async function createApp(options: CreateAppOptions = {}): Promise<INestApplication> {
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
    ...(options.logger === false ? { logger: false } : {}),
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

  return app;
}
