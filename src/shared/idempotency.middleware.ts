import { HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { problem } from '@/shared/problem.exception';

const TTL_MS = 24 * 60 * 60 * 1000;

interface InFlightRecord {
  state: 'in-flight';
  fingerprint: string;
  expiresAt: number;
}

interface DoneRecord {
  state: 'done';
  fingerprint: string;
  status: number;
  body: unknown;
  expiresAt: number;
}

type IdempotencyRecord = InFlightRecord | DoneRecord;

const store = new Map<string, IdempotencyRecord>();

function fingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

@Injectable()
export class IdempotencyMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['idempotency-key'];
    if (req.method !== 'POST' || typeof key !== 'string' || key.length === 0) {
      next();
      return;
    }

    const fp = fingerprint(req.body);

    let rec = store.get(key);
    if (rec && rec.expiresAt <= Date.now()) {
      store.delete(key);
      rec = undefined;
    }

    if (rec) {
      if (rec.fingerprint !== fp) {
        next(
          problem(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'idempotency-key-reuse',
            'This Idempotency-Key was already used with a different request body — one key belongs to one operation',
          ),
        );
        return;
      }
      if (rec.state === 'in-flight') {
        next(
          problem(
            HttpStatus.CONFLICT,
            'idempotency-in-flight',
            'A request with this Idempotency-Key is still in flight — retry in a moment',
          ),
        );
        return;
      }
      res.setHeader('Idempotency-Replay', 'true');
      res.status(rec.status).json(rec.body);
      return;
    }

    store.set(key, { state: 'in-flight', fingerprint: fp, expiresAt: Date.now() + TTL_MS });

    let captured: unknown;
    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      captured = body;
      return originalJson(body);
    }) as Response['json'];

    res.on('finish', () => {
      // 4xx means the handler rejected the request before or inside its DB
      // transaction, so nothing was written — releasing the key is correct and
      // lets the client fix the body and reuse it.
      //
      // 5xx is the opposite: the write may already have committed and the
      // failure happened afterwards (response validation against openapi.yaml
      // runs after the handler returns). Releasing the key there would let a
      // blind retry apply the same batch twice, so the error is remembered and
      // replayed instead.
      if (res.statusCode < HttpStatus.BAD_REQUEST || res.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
        store.set(key, {
          state: 'done',
          fingerprint: fp,
          status: res.statusCode,
          body: captured,
          expiresAt: Date.now() + TTL_MS,
        });
      } else {
        store.delete(key);
      }
    });

    next();
  }
}
