import { setTimeout as sleep } from 'node:timers/promises';
import express from 'express';
import { finish, listen, run } from './demo-kit';
import { queueRedis } from './redis/connections';
import { redisSession, SESSION_COOKIE, sessionKey } from './redis/session';

/**
 * HW #23 demo:session — one session across three requests and a process
 * "restart" (server and Redis client torn down and rebuilt); its TTL grows
 * back after activity.
 */
async function startPod() {
  const redis = queueRedis();
  const app = express();
  app.use(redisSession(redis));
  app.get('/me', (req, res) => res.json({ sid: req.sessionId }));
  const { url, close } = await listen(app, '/me');
  const stop = async () => {
    await close();
    await redis.quit();
  };
  return { url, stop };
}

async function main() {
  const probe = queueRedis();
  const sids = new Set<string>();
  let cookie = '';
  let requests = 0;
  const call = async (url: string) => {
    const res = await fetch(url, { headers: cookie ? { cookie } : {} });
    cookie = res.headers.get('set-cookie')?.split(';')[0] ?? cookie;
    const { sid } = (await res.json()) as { sid: string };
    requests++;
    sids.add(sid);
    return sid;
  };

  try {
    let pod = await startPod();
    const sid = await call(pod.url);
    await sleep(1500);

    const before = await probe.pttl(sessionKey(sid));
    await call(pod.url);
    const after = await probe.pttl(sessionKey(sid));
    console.log(`PTTL before activity ${before} ms, after ${after} ms`);

    // "Restart": the process state is gone, the session is not.
    await pod.stop();
    pod = await startPod();
    await call(pod.url);
    await pod.stop();

    const inRedis = (await probe.exists(sessionKey(sid))) === 1 ? 1 : 0;
    const ttlRenewed = after > before ? 1 : 0;
    finish({ requests, sessions: sids.size, 'in-redis': inRedis, 'ttl-renewed': ttlRenewed }, [
      !cookie.startsWith(`${SESSION_COOKIE}=`) && 'no session cookie was set',
      sids.size !== 1 && `${sids.size} different sessions, expected 1`,
      inRedis !== 1 && 'session key not found in Redis',
      ttlRenewed !== 1 && `TTL was not renewed (${before} -> ${after})`,
    ]);
    await probe.del(sessionKey(sid));
  } finally {
    await probe.quit();
  }
}

run(main);
