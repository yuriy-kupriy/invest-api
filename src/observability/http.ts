import { AsyncResource } from 'node:async_hooks';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from './context';
import { logger } from './logger';

const log = logger.child({ layer: 'http' });

/**
 * Opens the per-request ALS store and writes one `request completed` line.
 * The 'finish' listener is bound with AsyncResource.bind: an emitter callback
 * otherwise runs in whatever context emitted it and loses ours.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['idempotency-key'];
  const tenant = req.headers['x-tenant-id'];
  const store = {
    tenant: typeof tenant === 'string' && tenant ? tenant : 'default',
    idempotencyKey: typeof key === 'string' && key ? key : undefined,
    fault: process.env.FAULT_INJECTION === '1' && req.headers['x-fault'] === '1',
  };
  requestContext.run(store, () => {
    const started = process.hrtime.bigint();
    res.on(
      'finish',
      AsyncResource.bind(() => {
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        const fields = {
          req: { method: req.method, url: req.originalUrl, headers: req.headers, body: req.body },
          res: { statusCode: res.statusCode },
          ms: Math.round(ms * 100) / 100,
        };
        if (res.statusCode >= 500) log.error(fields, 'request completed');
        else log.info(fields, 'request completed');
      }),
    );
    next();
  });
}
