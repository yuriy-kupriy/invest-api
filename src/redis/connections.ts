import Redis, { RedisOptions, Result } from 'ioredis';
import { RELEASE_LOCK, SLIDING_WINDOW } from './lua';

declare module 'ioredis' {
  interface RedisCommander<Context> {
    releaseLock(key: string, token: string): Result<number, Context>;
    slidingWindow(key: string, windowMs: number, limit: number, member: string): Result<number, Context>;
  }
}

type UrlVar = 'REDIS_URL' | 'REDIS_QUEUE_URL';

function urlOf(name: UrlVar): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is not set — it lives in the vault (Infisical, dev), or export it (README ## Grading).`);
  return url;
}

function connect(name: UrlVar, opts: RedisOptions): Redis {
  const redis = new Redis(urlOf(name), opts);
  // Registered scripts go out as EVALSHA; the full Lua is sent only on NOSCRIPT.
  redis.defineCommand('releaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK });
  redis.defineCommand('slidingWindow', { numberOfKeys: 1, lua: SLIDING_WINDOW });
  return redis;
}

/** Cache instance: allkeys-lru, bounded maxmemory. Never put anything here that must survive. */
// Fail fast while Redis is down, so cacheAside falls back to the database at once
// instead of after ioredis' ~10 s of retries (the timeout also covers queued commands).
export const cacheRedis = (opts: RedisOptions = {}) =>
  connect('REDIS_URL', { maxRetriesPerRequest: 1, commandTimeout: 200, ...opts });

/** Queue instance: noeviction + AOF. BullMQ, sessions and rate-limit counters live here. */
export const queueRedis = (opts: RedisOptions = {}) => connect('REDIS_QUEUE_URL', opts);

/**
 * A URL rather than a client, for BullMQ: a client handed in is treated as
 * shared and is never closed by queue.close()/worker.close().
 */
export const queueUrl = () => urlOf('REDIS_QUEUE_URL');

export async function configGet(redis: Redis, name: string): Promise<string> {
  const reply = (await redis.config('GET', name)) as string[];
  return reply[1] ?? '';
}
