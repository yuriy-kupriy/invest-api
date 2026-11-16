import { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry } from 'prom-client';

export const registry = new Registry();

const labelNames = ['method', 'route', 'status'] as const;

export const httpRequests = new Counter({
  name: 'http_requests_total',
  help: 'HTTP requests by method, route template and status code',
  labelNames,
  registers: [registry],
});

/**
 * Top finite bucket (30 s) sits well above the worst request we have measured
 * (see README ## Observability), so histogram_quantile never pins to the edge
 * exactly when things go bad.
 */
export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by method, route template and status code',
  labelNames,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

/**
 * The route label is the TEMPLATE (/transactions/:transaction_id), never the raw
 * path: a hundred ids must not mint a hundred series. Requests that matched no
 * route all share 'unmatched'.
 */
function routeOf(req: Request): string {
  const openapiRoute = (req as Request & { openapi?: { expressRoute?: string } }).openapi?.expressRoute;
  return (req.route?.path as string | undefined) ?? openapiRoute ?? 'unmatched';
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const stop = httpDuration.startTimer();
  res.on('finish', () => {
    const labels = { method: req.method, route: routeOf(req), status: String(res.statusCode) };
    httpRequests.inc(labels);
    stop(labels);
  });
  next();
}

export async function metricsHandler(_req: Request, res: Response): Promise<void> {
  res.setHeader('Content-Type', registry.contentType);
  res.end(await registry.metrics());
}
