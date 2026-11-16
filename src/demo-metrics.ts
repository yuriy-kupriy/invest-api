import { randomUUID } from 'node:crypto';
import { run } from './demo-kit';
import { runObsDemo } from './demo-obs-kit';

/**
 * HW #29 demo:metrics — RED counts what really happened, and the label set is
 * bounded: 100 requests with 100 different ids to /transactions/:transaction_id
 * add no new series. Every number below comes from two scrapes of /metrics.
 */
const ROUTE = '/transactions/:transaction_id';
const REQUESTS = 100;
const FAIL_EVERY = 10;
const TOP_BUCKET = '30';

interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseMetrics(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    const m = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)$/.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    for (const [, k, v] of (m[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[k] = v;
    samples.push({ name: m[1], labels, value: Number(m[3]) });
  }
  return samples;
}

function sum(samples: Sample[], name: string, where: (l: Record<string, string>) => boolean): number {
  return samples.filter((s) => s.name === name && where(s.labels)).reduce((acc, s) => acc + s.value, 0);
}

run(() =>
  runObsDemo(async (obs) => {
    const scrape = async () => parseMetrics((await obs.call('GET', '/metrics')).text);
    const get = (id: string, fail: boolean) =>
      obs.call('GET', `/transactions/${id}`, { headers: fail ? { 'x-fault': '1' } : {} });

    // Warm the route with the same outcome mix the run will produce (404 + 500),
    // so series-before already holds every series that legitimately exists.
    await get(randomUUID(), false);
    await get(randomUUID(), true);

    const before = await scrape();
    const ids = Array.from({ length: REQUESTS }, () => randomUUID());
    let ok = 0;
    let fail = 0;
    for (const [i, id] of ids.entries()) {
      const r = await get(id, i % FAIL_EVERY === 0);
      if (r.status >= 500) fail += 1;
      else ok += 1;
    }
    const after = await scrape();

    const onRoute = (l: Record<string, string>) => l.route === ROUTE;
    const is5xx = (l: Record<string, string>) => onRoute(l) && /^5\d\d$/.test(l.status);
    const series = (s: Sample[]) => s.filter((x) => x.name === 'http_requests_total').length;
    const count = sum(after, 'http_request_duration_seconds_count', onRoute);
    const inTop = sum(after, 'http_request_duration_seconds_bucket', (l) => onRoute(l) && l.le === TOP_BUCKET);
    const maxMs = Math.max(
      ...obs.logs().filter((l) => l.msg === 'request completed' && typeof l.ms === 'number').map((l) => l.ms),
    );

    const summary = {
      'sent-ok': ok,
      'sent-fail': fail,
      'counter-delta': sum(after, 'http_requests_total', onRoute) - sum(before, 'http_requests_total', onRoute),
      'errors-delta': sum(after, 'http_requests_total', is5xx) - sum(before, 'http_requests_total', is5xx),
      'above-top-bucket': count - inTop,
      'series-before': series(before),
      'series-after': series(after),
      'distinct-ids': new Set(ids).size,
      'worst-ms': Math.round(maxMs),
    };
    return {
      summary,
      checks: [
        ok + fail < 50 && `sent ${ok + fail}, expected >= 50`,
        summary['counter-delta'] !== ok + fail && `counter-delta=${summary['counter-delta']}, expected ${ok + fail}`,
        summary['errors-delta'] !== fail && `errors-delta=${summary['errors-delta']}, expected ${fail}`,
        summary['above-top-bucket'] !== 0 && `above-top-bucket=${summary['above-top-bucket']}, expected 0 — add buckets`,
        summary['series-after'] !== summary['series-before'] &&
          `series grew ${summary['series-before']} -> ${summary['series-after']}: an unbounded label`,
      ],
    };
  }),
);
