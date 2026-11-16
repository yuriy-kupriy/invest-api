import { randomBytes } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import Redis from 'ioredis';
import { sendProblem } from '../shared/problem.format';
import { problem } from '../shared/problem.exception';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
  /** Who is being limited. Defaults to the client IP. */
  clientId?: (req: Request) => string;
}

export const rateLimitKey = (client: string) => `rl:${client}`;

/** Counter lives in Redis, so every pod of the service shares one limit. */
export function rateLimit(redis: Redis, { limit, windowMs, clientId = (req) => req.ip ?? 'unknown' }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const member = randomBytes(8).toString('hex');
      const retryMs = await redis.slidingWindow(rateLimitKey(clientId(req)), windowMs, limit, member);
      if (retryMs === 0) return next();
      res.setHeader('Retry-After', String(Math.ceil(retryMs / 1000)));
      sendProblem(problem(HttpStatus.TOO_MANY_REQUESTS, 'rate_limited', `More than ${limit} requests in ${windowMs / 1000} s`), req, res);
    } catch (err) {
      next(err);
    }
  };
}
