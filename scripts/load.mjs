// HW #28 load generator: CONCURRENCY loops hit <url> back to back and append the
// status of every response to <file>, one per line — `000` when no response came
// at all (refused, reset, timeout). On direct NodePort a broken rollout shows up
// as 000, not 5xx. agent:false => a fresh connection per request, so a dying
// pod cannot hide behind a pooled keep-alive socket.
//
//   node scripts/load.mjs <url> <file>      (stop with SIGTERM/SIGINT)
import { createWriteStream } from 'node:fs';
import http from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const [url, file] = process.argv.slice(2);
if (!url || !file) {
  console.error('usage: node scripts/load.mjs <url> <file>');
  process.exit(2);
}
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 16);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);
// Each loop starts at most one request per INTERVAL_MS. Without pacing a refused
// connection (000) returns in microseconds while a 200 takes milliseconds, so a
// broken rollout would be over-counted thousands of times per second.
const INTERVAL_MS = Number(process.env.INTERVAL_MS ?? 20);

const out = createWriteStream(file, { flags: 'a' });
let running = true;
const stop = () => { running = false; };
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

function once() {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false, timeout: TIMEOUT_MS }, (res) => {
      res.resume();
      // 'close' fires on every path; a body cut off mid-way is no answer at all.
      res.on('close', () => resolve(res.complete ? String(res.statusCode) : '000'));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve('000'));
  });
}

async function loop() {
  while (running) {
    const started = Date.now();
    out.write(`${await once()}\n`);
    await sleep(Math.max(0, INTERVAL_MS - (Date.now() - started)));
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, loop));
out.end();
