import { run, waitFor } from './demo-kit';
import { checkoutBody, newIdempotencyKey, runObsDemo, traceparent } from './demo-obs-kit';

/**
 * HW #29 demo:trace — one key opens two doors. A checkout carrying our own
 * traceparent is made to fail with a 500; then the trace is fetched back from
 * the trace backend (Jaeger query API, TRACE_API_URL) and compared with both
 * the header we sent and the service's own log lines.
 */
interface JaegerSpan {
  traceID: string;
  spanID: string;
  operationName: string;
  references?: { refType: string; traceID: string; spanID: string }[];
  tags?: { key: string; value: unknown }[];
}

const tag = (span: JaegerSpan, key: string) => span.tags?.find((t) => t.key === key)?.value;

run(() =>
  runObsDemo(async (obs) => {
    const traceApi = process.env.TRACE_API_URL;
    if (!traceApi) throw new Error('TRACE_API_URL is not set (Jaeger query API, see README ## Observability)');

    const tp = traceparent();
    const reply = await obs.call('POST', '/transactions', {
      headers: { traceparent: tp.header, 'idempotency-key': newIdempotencyKey(), 'x-fault': '1' },
      body: checkoutBody(obs.accountId),
    });
    await obs.completed(tp.traceId);

    // The batch exporter ships spans every 100 ms here, not instantly: poll.
    let spans: JaegerSpan[] = [];
    await waitFor(
      `trace ${tp.traceId} in ${traceApi}`,
      async () => {
        const res = await fetch(`${traceApi}/api/traces/${tp.traceId}`).catch(() => undefined);
        if (!res?.ok) return false;
        const body = (await res.json()) as { data?: { spans: JaegerSpan[] }[] };
        const found = body.data?.[0]?.spans ?? [];
        // Wait for the server span: it ends last, after its children.
        if (found.some((s) => tag(s, 'span.kind') === 'server')) {
          spans = found;
          return true;
        }
        return false;
      },
      20_000,
    );

    const ids = new Set(spans.map((s) => s.spanID));
    const parentOf = (s: JaegerSpan) => s.references?.find((r) => r.refType === 'CHILD_OF')?.spanID;
    const orphans = spans.filter((s) => {
      const parent = parentOf(s);
      return parent !== undefined && !ids.has(parent) && parent !== tp.parentId;
    });
    const server = spans.find((s) => tag(s, 'span.kind') === 'server')!;

    const logLines = obs.logs().filter((l) => l.trace_id === tp.traceId && l.layer && l.layer !== 'http');
    const repoLine = logLines.find((l) => l.layer === 'transactions.repo');
    const logMatches =
      repoLine !== undefined &&
      logLines.every((l) => l.trace_id === server.traceID && ids.has(l.span_id)) ? 1 : 0;

    const summary = {
      status: reply.status,
      spans: spans.length,
      'orphan-spans': orphans.length,
      'trace-matches-header':
        spans.every((s) => s.traceID === tp.traceId) && parentOf(server) === tp.parentId ? 1 : 0,
      'trace-matches-log': logMatches,
      'log-lines-checked': logLines.length,
      'span-status-error': tag(server, 'otel.status_code') === 'ERROR' ? 1 : 0,
    };
    return {
      summary,
      checks: [
        reply.status < 500 && `expected a 5xx, got ${reply.status}`,
        summary.spans < 2 && `spans=${summary.spans}, expected >= 2 (server + db/manual)`,
        summary['orphan-spans'] !== 0 && `orphan-spans=${summary['orphan-spans']}`,
        summary['trace-matches-header'] !== 1 && 'trace does not continue the traceparent header',
        summary['trace-matches-log'] !== 1 && 'log trace_id/span_id do not match the stored spans',
        summary['span-status-error'] !== 1 && 'server span of the 5xx is not status ERROR',
      ],
    };
  }),
);
