import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import express, { NextFunction, Request, Response } from 'express';
import * as OpenApiValidator from 'express-openapi-validator';
import { AppModule } from '@/app.module';
import { requestContextMiddleware } from '@/observability/http';
import { PinoNestLogger } from '@/observability/logger';
import { metricsHandler, metricsMiddleware } from '@/observability/metrics';
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
  // HW #29: /metrics before the OpenAPI validator (it is not in the spec, the
  // validator would 404 it) and outside the RED counter it reports.
  server.get('/metrics', metricsHandler);
  server.use(metricsMiddleware);
  // The trade webhook's HMAC is over the bytes as sent, not over a re-serialised object.
  server.use(express.json({ verify: (req, _res, buf) => ((req as { rawBody?: Buffer }).rawBody = buf) }));
  // After body parsing: the parser's stream callbacks would not carry our ALS store.
  server.use(requestContextMiddleware);
  server.use(
    OpenApiValidator.middleware({
      apiSpec: join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      // Re-validating every response body costs CPU on each request; dev, test and
      // CI catch spec drift, production trusts what they already proved.
      // main.ts has run validateEnv before this, so NODE_ENV is a known value.
      validateResponses: process.env.NODE_ENV !== 'production',
      // The spec documents bearerAuth, but JwtAuthGuard is the one authority on
      // tokens: two checkers would answer 401 with two different bodies.
      validateSecurity: false,
      ignorePaths: /^\/docs/,
    }),
  );

  const app = await NestFactory.create(AppModule, new ExpressAdapter(server), {
    bodyParser: false,
    logger: options.logger === false ? false : new PinoNestLogger(),
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
