import { randomBytes, randomUUID } from 'node:crypto';
import { run } from './demo-kit';
import { checkoutBody, LogLine, runObsDemo, traceparent } from './demo-obs-kit';

/**
 * HW #29 demo:logs — the correlator lives in context, not in arguments.
 *   - one checkout: every line of it carries ONE trace_id, equal to the one in
 *     the traceparent we sent, across >= 3 layers (controller, service, repo);
 *   - a burst of 8 identical checkouts in parallel, each with its own
 *     traceparent and Idempotency-Key: grouping lines by trace_id gives 8
 *     groups of one size, and every line of a group carries its own request's
 *     idempotencyKey and userId (a "current request" module variable breaks it);
 *   - login with a Bearer marker and a password marker: the request line is
 *     logged, neither marker is.
 */
const BURST = 8;

run(() =>
  runObsDemo(async (obs) => {

    // 1. One request, three layers, one key.
    const one = traceparent();
    const single = await obs.call('POST', '/transactions', {
      headers: { traceparent: one.header, 'idempotency-key': randomUUID() },
      body: checkoutBody(obs.accountId),
    });
    if (single.status !== 201) throw new Error(`checkout failed: ${single.status} ${single.text}`);
    await obs.completed(one.traceId);
    // Every line between the request's first and its `request completed` that names a layer.
    const before = obs.logs();
    const first = before.findIndex((l) => l.trace_id === one.traceId);
    const last = before.findIndex((l) => l.trace_id === one.traceId && l.msg === 'request completed');
    const window = before.slice(first, last + 1).filter((l) => l.layer);
    const layers = new Set(window.map((l) => l.layer));
    const singleTraceIds = new Set(window.map((l) => l.trace_id));

    // 2. Burst: N identical requests in parallel, own traceparent + key each.
    const sent = Array.from({ length: BURST }, () => ({ tp: traceparent(), key: randomUUID() }));
    const replies = await Promise.all(
      sent.map(({ tp, key }) =>
        obs.call('POST', '/transactions', {
          headers: { traceparent: tp.header, 'idempotency-key': key },
          body: checkoutBody(obs.accountId),
        }),
      ),
    );
    const failed = replies.filter((r) => r.status !== 201);
    if (failed.length > 0) throw new Error(`burst checkout failed: ${failed.map((r) => r.status).join(',')}`);
    for (const { tp } of sent) await obs.completed(tp.traceId);

    const groups = new Map<string, LogLine[]>();
    for (const line of obs.logs()) {
      if (sent.some((s) => s.tp.traceId === line.trace_id)) {
        groups.set(line.trace_id, [...(groups.get(line.trace_id) ?? []), line]);
      }
    }
    const sizes = [...groups.values()].map((g) => g.length);
    const expectedSize = Math.max(...sizes);
    let uneven = 0;
    for (const { tp, key } of sent) {
      const group = groups.get(tp.traceId) ?? [];
      const mixed = group.some((l) => l.idempotencyKey !== key || l.userId !== obs.userId);
      if (group.length !== expectedSize || mixed) uneven += 1;
    }

    // 3. Secrets: Bearer marker + password marker on the login request.
    const tokenMarker = `tok-${randomBytes(8).toString('hex')}`;
    const passwordMarker = `pwd-${randomBytes(8).toString('hex')}`;
    const secret = traceparent();
    await obs.call('POST', '/auth/login', {
      token: tokenMarker,
      headers: { traceparent: secret.header },
      body: { email: 'demo-owner@example.com', password: passwordMarker },
    });
    const loginLine = await obs.completed(secret.traceId);
    const leaked = obs.stdout.filter((l) => l.includes(tokenMarker) || l.includes(passwordMarker)).length;

    const nonJson = obs.stdout.filter((l) => {
      try {
        const v = JSON.parse(l);
        return !v || typeof v !== 'object';
      } catch {
        return true;
      }
    }).length;

    const summary = {
      'lines-total': obs.stdout.length,
      'non-json-lines': nonJson,
      layers: layers.size,
      'distinct-trace-ids': singleTraceIds.size,
      'trace-id-matches-header': singleTraceIds.size === 1 && singleTraceIds.has(one.traceId) ? 1 : 0,
      burst: BURST,
      'burst-trace-ids': groups.size,
      'burst-group-size': expectedSize,
      'burst-uneven': uneven,
      'secret-req-logged': loginLine.req?.url === '/auth/login' ? 1 : 0,
      'secret-in-logs': leaked,
    };
    return {
      summary,
      checks: [
        summary['non-json-lines'] !== 0 && `non-json-lines=${summary['non-json-lines']}, expected 0`,
        summary.layers < 3 && `layers=${summary.layers}, expected >= 3`,
        summary['distinct-trace-ids'] !== 1 && `distinct-trace-ids=${summary['distinct-trace-ids']}, expected 1`,
        summary['trace-id-matches-header'] !== 1 && 'trace_id in the log differs from the traceparent header',
        summary['burst-trace-ids'] !== BURST && `burst-trace-ids=${summary['burst-trace-ids']}, expected ${BURST}`,
        summary['burst-uneven'] !== 0 && `burst-uneven=${summary['burst-uneven']}, expected 0`,
        summary['secret-req-logged'] !== 1 && 'the login request line is missing',
        summary['secret-in-logs'] !== 0 && `secret-in-logs=${summary['secret-in-logs']}, expected 0`,
      ],
    };
  }),
);
