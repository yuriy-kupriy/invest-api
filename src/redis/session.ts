import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';

export const SESSION_TTL_MS = 30 * 60_000;
export const SESSION_COOKIE = 'sid';
export const sessionKey = (sid: string) => `sess:${sid}`;
// Plain-HTTP localhost in dev and in the demo; HTTPS-only cookie everywhere else.
const SECURE = process.env.NODE_ENV === 'production' ? '; Secure' : '';

declare module 'express-serve-static-core' {
  interface Request {
    sessionId?: string;
    session?: Record<string, string>;
  }
}

function cookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}

/**
 * Session state in a Redis hash with a rolling TTL: every request reads it and
 * pushes the expiry forward in one MULTI, so an active user is never dropped
 * mid-work. Lives in Redis, not process memory — survives a restart.
 */
export function redisSession(redis: Redis) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      let sid = cookie(req, SESSION_COOKIE);
      let data: Record<string, string> = {};
      if (sid) {
        const [[, found]] = (await redis.multi().hgetall(sessionKey(sid)).pexpire(sessionKey(sid), SESSION_TTL_MS).exec()) as [
          [Error | null, Record<string, string>],
        ];
        data = found;
      }
      if (!sid || Object.keys(data).length === 0) {
        sid = randomBytes(32).toString('base64url');
        data = { createdAt: new Date().toISOString() };
        await redis.multi().hset(sessionKey(sid), data).pexpire(sessionKey(sid), SESSION_TTL_MS).exec();
        res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${SECURE}`);
      }
      req.sessionId = sid;
      req.session = data;
      next();
    } catch (err) {
      next(err);
    }
  };
}
