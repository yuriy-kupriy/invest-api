import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '@/create-app';

/**
 * Boots the real request pipeline — OpenApiValidator (request + response) →
 * Idempotency-Key middleware → Nest controllers → problem+json error handler —
 * exactly as main.ts does, minus the actual listen(). This is what the
 * acceptance-criteria curl scenarios in README.md exercise by hand; here they
 * run on every `npm run test:e2e`.
 */
describe('invest-api (e2e)', () => {
  let app: INestApplication;

  const cashAccountId = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const validEntry = {
    account_id: cashAccountId,
    type: 'expense',
    amount_cents: 1250,
    currency: 'UAH',
    occurred_at: '2026-08-25T10:00:00.000Z',
    description: 'Lunch',
  };

  it('rejects POST /transactions without Idempotency-Key as problem+json', async () => {
    const res = await request(app.getHttpServer())
      .post('/transactions')
      .send({ entries: [validEntry] });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.detail).toMatch(/idempotency-key/i);
  });

  it('rejects an empty entries batch as a 400 from the validator', async () => {
    const res = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', `e2e-empty-${randomUUID()}`)
      .send({ entries: [] });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.detail).toMatch(/entries/);
  });

  it('creates a transaction on a valid request', async () => {
    const res = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', `e2e-create-${randomUUID()}`)
      .send({ entries: [validEntry] });

    expect(res.status).toBe(201);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['idempotency-replay']).toBeUndefined();
  });

  it('replays the same 201 for the same key + same body, without creating a new record', async () => {
    const key = `e2e-replay-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });
    expect(first.status).toBe(201);

    const replay = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replay']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('rejects the same key reused with a different body as 422 problem+json', async () => {
    const key = `e2e-reuse-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });
    expect(first.status).toBe(201);

    const second = await request(app.getHttpServer())
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [{ ...validEntry, amount_cents: 999 }] });

    expect(second.status).toBe(422);
    expect(second.headers['content-type']).toContain('application/problem+json');
    expect(second.body.code).toBe('idempotency-key-reuse');
  });

  it('paginates GET /accounts with items + next_cursor', async () => {
    const res = await request(app.getHttpServer()).get('/accounts').query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('next_cursor');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('returns 404 problem+json for an unknown account', async () => {
    const res = await request(app.getHttpServer()).get(
      `/accounts/${randomUUID()}`,
    );

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(404);
  });

  it('answers GET /health without touching the database', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // The response also passed the OpenApiValidator against the Health schema,
    // which is what keeps /health honest about its own shape.
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body.node_env).toBe('test');
  });
});
