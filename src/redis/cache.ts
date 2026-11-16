import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import Redis from 'ioredis';

const TTL_BASE_S = 300;
const TTL_JITTER_S = 60;
const LOCK_TTL_MS = 5_000;
const POLL_MS = 25;

/** 300..360 s, so keys warmed in one pass do not expire in the same second. */
const jitteredTtl = () => TTL_BASE_S + Math.floor(Math.random() * (TTL_JITTER_S + 1));

const parse = <T>(raw: string | null) => (raw === null ? undefined : (JSON.parse(raw) as T));

async function singleFlight<T>(redis: Redis, key: string, load: () => Promise<T>): Promise<T> {
  const lockKey = `lock:${key}`;
  let hit = parse<T>(await redis.get(key));
  for (;;) {
    if (hit !== undefined) return hit;

    const token = randomBytes(16).toString('hex');
    if ((await redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK') {
      try {
        // Someone may have filled the cache between our miss and our lock.
        const late = parse<T>(await redis.get(key));
        if (late !== undefined) return late;
        const value = await load();
        await redis.set(key, JSON.stringify(value), 'EX', jitteredTtl()).catch((err: Error) => {
          console.warn(`cache write failed for ${key}: ${err.message}`);
        });
        return value;
      } finally {
        // A failed release only delays the next miss until the lock's PX runs out.
        await redis.releaseLock(lockKey, token).catch(() => undefined);
      }
    }

    // Lost the race: one round trip per poll until the winner's value lands or its lock is gone.
    const deadline = Date.now() + LOCK_TTL_MS;
    while (Date.now() < deadline) {
      await sleep(POLL_MS);
      const [[, raw], [, locked]] = (await redis.pipeline().get(key).exists(lockKey).exec()) as [
        [Error | null, string | null],
        [Error | null, number],
      ];
      hit = parse<T>(raw);
      if (hit !== undefined || !locked) break;
    }
  }
}

/**
 * Cache-aside with a single-flight lock: on a miss only the client that wins
 * SET NX goes to the database, the rest poll the cache. The lock is an
 * optimisation — if it breaks, the database is read twice and the same value
 * is written twice, nothing is corrupted. Redis being down degrades to a
 * plain database read: a cache that fails the request is not a cache.
 */
export async function cacheAside<T>(redis: Redis, key: string, load: () => Promise<T>): Promise<T> {
  let loading = false;
  try {
    return await singleFlight(redis, key, () => {
      loading = true;
      return load();
    });
  } catch (err) {
    if (loading) throw err; // the database failed, not the cache
    console.warn(`cache unavailable for ${key}, reading through: ${(err as Error).message}`);
    return load();
  }
}
