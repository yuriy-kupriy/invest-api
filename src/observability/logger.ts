import { LoggerService } from '@nestjs/common';
import { trace } from '@opentelemetry/api';
import pino from 'pino';
import { requestContext } from './context';

/**
 * HW #29. One JSON line per event on stdout. The correlator is the trace_id of
 * the active OTel span — never a home-made uuid — so a log line and its span
 * share one key. userId / tenant / idempotencyKey come from AsyncLocalStorage;
 * no function takes `req` just to log.
 *
 * Request bodies are never logged (see http.ts). redact matches exact paths
 * only: a secret nested under a path not listed here is NOT hidden.
 */
export const loggerOptions: pino.LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  base: { service: 'invest-api' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    censor: '[REDACTED]',
  },
  mixin() {
    const span = trace.getActiveSpan()?.spanContext();
    const ctx = requestContext.getStore();
    return {
      trace_id: span?.traceId,
      span_id: span?.spanId,
      userId: ctx?.userId,
      tenant: ctx?.tenant,
      idempotencyKey: ctx?.idempotencyKey,
    };
  },
};

export const logger = pino(loggerOptions);

/** Nest's own messages as JSON too: its context becomes the `layer` field. */
export class PinoNestLogger implements LoggerService {
  log(message: unknown, context?: string): void {
    logger.info({ layer: context }, String(message));
  }
  error(message: unknown, trace?: string, context?: string): void {
    logger.error({ layer: context, stack: trace }, String(message));
  }
  warn(message: unknown, context?: string): void {
    logger.warn({ layer: context }, String(message));
  }
  debug(message: unknown, context?: string): void {
    logger.debug({ layer: context }, String(message));
  }
  verbose(message: unknown, context?: string): void {
    logger.trace({ layer: context }, String(message));
  }
}
