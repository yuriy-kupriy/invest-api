import { CallHandler, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Request, Response } from 'express';
import { Observable, of, tap } from 'rxjs';
import { AuthUser } from '@/auth/auth.types';
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
  body: unknown;
  expiresAt: number;
}

type IdempotencyRecord = InFlightRecord | DoneRecord;

const store = new Map<string, IdempotencyRecord>();

function fingerprint(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * An interceptor, not a middleware: it runs after the guards, so `req.user` is
 * the caller JwtAuthGuard already verified, and the key namespace is per user —
 * user B sending A's key never gets A's response replayed. It still runs before
 * the ValidationPipe and after the OpenAPI validator, as the middleware did.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const rawKey = req.headers['idempotency-key'];
    const user = req.user as AuthUser | undefined;
    if (req.method !== 'POST' || typeof rawKey !== 'string' || rawKey.length === 0 || !user) {
      return next.handle();
    }
    const key = `${user.id}:${rawKey}`;

    const fp = fingerprint(req.body);

    let rec = store.get(key);
    if (rec && rec.expiresAt <= Date.now()) {
      store.delete(key);
      rec = undefined;
    }

    if (rec) {
      if (rec.fingerprint !== fp) {
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'idempotency-key-reuse',
          'This Idempotency-Key was already used with a different request body — one key belongs to one operation',
        );
      }
      if (rec.state === 'in-flight') {
        throw problem(
          HttpStatus.CONFLICT,
          'idempotency-in-flight',
          'A request with this Idempotency-Key is still in flight — retry in a moment',
        );
      }
      // Only 201s are stored, and the route's own @HttpCode(201) applies again.
      res.setHeader('Idempotency-Replay', 'true');
      return of(rec.body);
    }

    store.set(key, { state: 'in-flight', fingerprint: fp, expiresAt: Date.now() + TTL_MS });

    let captured: unknown;
    res.on('finish', () => {
      // Only a successful response is worth replaying. Any error — 4xx or 5xx —
      // releases the key so the client can retry, which is the entire purpose
      // of handing out an idempotency key in the first place.
      //
      // An earlier revision also cached 5xx, reasoning that a write might have
      // committed before the failure. That traded a rare double-write for a
      // guaranteed one: a transient 500 (rolled back, nothing written) left the
      // key unusable for the full 24h TTL, so the operation could never be
      // completed — and the replay carried an empty body, because error
      // responses go out through `sendProblem()`/`res.send()` and never reach
      // the handler's return value captured below.
      //
      // The window that argument worried about is now vanishingly small: the
      // handler's work is one DB transaction, and the only step left after
      // COMMIT is serialising the response.
      if (res.statusCode === HttpStatus.CREATED) {
        store.set(key, {
          state: 'done',
          fingerprint: fp,
          body: captured,
          expiresAt: Date.now() + TTL_MS,
        });
      } else {
        store.delete(key);
      }
    });

    return next.handle().pipe(tap((body) => (captured = body)));
  }
}
