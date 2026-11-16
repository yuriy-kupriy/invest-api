import './register-aliases';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { finish, listen, run } from './demo-kit';
import { queueRedis } from './redis/connections';
import { rateLimit, rateLimitKey } from './redis/rate-limit';

/**
 * HW #23 demo:ratelimit — two independent limiter instances ("pods", each with
 * its own Redis connection and HTTP server) share one limit for one client.
 */
const INSTANCES = 2;
const LIMIT = 5;
const WINDOW_MS = 10_000;
const REQUESTS = 12;

async function main() {
  const client = `demo-${randomUUID()}`;
  const pods = [];
  for (let i = 0; i < INSTANCES; i++) {
    const redis = queueRedis();
    const app = express();
    app.use(rateLimit(redis, { limit: LIMIT, windowMs: WINDOW_MS, clientId: (req) => String(req.headers['x-client-id']) }));
    app.get('/ping', (_req, res) => res.json({ pod: i }));
    pods.push({ redis, ...(await listen(app, '/ping')) });
  }

  try {
    let allowed = 0;
    let blocked = 0;
    let status = 0;
    let retryAfter = 0;
    for (let i = 0; i < REQUESTS; i++) {
      const res = await fetch(pods[i % INSTANCES].url, { headers: { 'x-client-id': client } });
      await res.arrayBuffer();
      if (res.status === 200) allowed++;
      else {
        blocked++;
        status = res.status;
        retryAfter = Number(res.headers.get('retry-after'));
      }
    }
    console.log(`last rejection: ${status}, Retry-After: ${retryAfter} s`);
    finish(
      { instances: INSTANCES, limit: LIMIT, requests: REQUESTS, allowed, blocked, status, 'retry-after': retryAfter > 0 ? 1 : 0 },
      [
        allowed !== LIMIT && `allowed ${allowed}, expected ${LIMIT} — limit is not shared`,
        blocked !== REQUESTS - LIMIT && `blocked ${blocked}, expected ${REQUESTS - LIMIT}`,
        status !== 429 && `last rejection status ${status}, expected 429`,
        !(retryAfter > 0) && 'no Retry-After header',
      ],
    );
    await pods[0].redis.del(rateLimitKey(client));
  } finally {
    for (const pod of pods) {
      await pod.close();
      await pod.redis.quit();
    }
  }
}

run(main);
