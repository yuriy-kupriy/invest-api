import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import pino from 'pino';
import request from 'supertest';
import { createApp } from '@/create-app';
import { loggerOptions } from '@/observability/logger';

/**
 * HW #29 guarantees that the demos prove but CI cannot run (they need Jaeger):
 * secrets in headers never reach a log line, and the RED route label is the
 * template, so new ids mint no new series.
 */
describe('observability (e2e)', () => {
  it('redacts Authorization and Cookie from the request log line', () => {
    const lines: string[] = [];
    const log = pino({ ...loggerOptions, level: 'info' }, { write: (line: string) => lines.push(line) });

    log.info({ req: { headers: { authorization: 'Bearer tok-secret', cookie: 'sid=cookie-secret' } } }, 'request completed');

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('tok-secret');
    expect(lines[0]).not.toContain('cookie-secret');
    expect(JSON.parse(lines[0]).req.headers.authorization).toBe('[REDACTED]');
  });

  describe('RED metrics', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp({ logger: false });
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    const series = async () =>
      (await request(app.getHttpServer()).get('/metrics').expect(200)).text
        .split('\n')
        .filter((line) => line.startsWith('http_requests_total{'));

    it('labels by route template: a new id adds no series', async () => {
      const first = randomUUID();
      // 401 without a token is fine: the route matched, which is all the label needs.
      await request(app.getHttpServer()).get(`/transactions/${first}`);
      const before = await series();

      const second = randomUUID();
      await request(app.getHttpServer()).get(`/transactions/${second}`);
      const after = await series();

      expect(before.some((line) => line.includes('route="/transactions/:transaction_id"'))).toBe(true);
      expect(after).toHaveLength(before.length);
      expect(after.join('\n')).not.toContain(first);
      expect(after.join('\n')).not.toContain(second);
    });
  });
});
