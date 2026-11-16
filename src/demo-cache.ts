import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { finish, run } from './demo-kit';
import { AccountMonthSummaryRepository, cachedMonthSummary, summaryKey } from './redis/account-month-summary';
import { cacheRedis, configGet } from './redis/connections';

/**
 * HW #23 demo:cache — cache-aside on the monthly account summary: jittered TTLs
 * on warm-up, one database read for a stampede of concurrent requests on a key
 * that just disappeared, zero database reads on a warm cache.
 */
const ACCOUNT_ID = '00000002-0000-4000-8000-000000000002'; // seeded by src/seed.ts
const WARMED = 50;
const CONCURRENT = 20;
const WARM_READS = 100;

const months = Array.from({ length: WARMED }, (_, i) => {
  const d = new Date(Date.UTC(2022, i, 1));
  return d.toISOString().slice(0, 7);
});

async function main() {
  const ds = await new DataSource(dataSourceOptions).initialize();
  const redis = cacheRedis();
  const clients: Redis[] = Array.from({ length: CONCURRENT }, () => cacheRedis());
  try {
    const [policy, maxmemory] = await Promise.all([configGet(redis, 'maxmemory-policy'), configGet(redis, 'maxmemory')]);
    const cacheLru = policy !== 'noeviction' ? 1 : 0;
    const cacheMaxmemory = Number(maxmemory) > 0 ? 1 : 0;

    await redis.del(...months.map((m) => summaryKey(ACCOUNT_ID, m)), ...months.map((m) => `lock:${summaryKey(ACCOUNT_ID, m)}`));
    const repo = new AccountMonthSummaryRepository(ds);

    // 1. Warm-up: every key is a miss, every key gets its own TTL.
    for (const m of months) await cachedMonthSummary(redis, repo, ACCOUNT_ID, m);
    const ttls = await Promise.all(months.map((m) => redis.ttl(summaryKey(ACCOUNT_ID, m))));
    const warmed = ttls.filter((t) => t > 0).length;
    const ttlDistinct = new Set(ttls).size;
    const warmupCalls = repo.dbCalls;

    // 2. Stampede: the key vanishes, 20 independent clients ask for it at once.
    const hot = months[0];
    await redis.del(summaryKey(ACCOUNT_ID, hot));
    repo.dbCalls = 0;
    const results = await Promise.all(clients.map((c) => cachedMonthSummary(c, repo, ACCOUNT_ID, hot)));
    const dbCalls = repo.dbCalls;
    const first = JSON.stringify(results[0]);
    const same = results.every((r) => JSON.stringify(r) === first);

    // 3. Warm cache: 100 reads spread over the warmed keys.
    repo.dbCalls = 0;
    for (let i = 0; i < WARM_READS; i++) await cachedMonthSummary(redis, repo, ACCOUNT_ID, months[i % WARMED]);
    const dbCallsWarm = repo.dbCalls;

    console.log(`warm-up: ${warmupCalls} database reads for ${WARMED} keys, TTL range ${Math.min(...ttls)}..${Math.max(...ttls)} s`);
    finish(
      {
        'cache-lru': cacheLru,
        'cache-maxmemory': cacheMaxmemory,
        warmed,
        'ttl-distinct': ttlDistinct,
        concurrent: CONCURRENT,
        'db-calls': dbCalls,
        'db-calls-warm': dbCallsWarm,
      },
      [
        cacheLru !== 1 && 'cache instance has maxmemory-policy noeviction',
        cacheMaxmemory !== 1 && 'cache instance has no maxmemory',
        warmed !== WARMED && `warmed ${warmed}, expected ${WARMED}`,
        ttlDistinct < 5 && `only ${ttlDistinct} distinct TTLs — no jitter?`,
        dbCalls !== 1 && `stampede made ${dbCalls} database reads, expected 1`,
        !same && 'concurrent readers got different values',
        dbCallsWarm !== 0 && `warm cache made ${dbCallsWarm} database reads`,
      ],
    );
    await redis.del(...months.map((m) => summaryKey(ACCOUNT_ID, m)));
  } finally {
    await Promise.all([redis, ...clients].map((c) => c.quit()));
    await ds.destroy();
  }
}

run(main);
