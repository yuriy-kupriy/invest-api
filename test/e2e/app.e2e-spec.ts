import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { getDataSourceToken } from '@nestjs/typeorm';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { hashPassword } from '@/auth/password';
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
  // The fixture user every db/dev-fixtures.sql account belongs to.
  const owner = { email: 'user1@example.com', password: 'e2e-password' };
  let token = '';

  /** supertest with the owner's access token — every non-public route needs one since HW #24. */
  const api = () => request.agent(app.getHttpServer()).set('Authorization', `Bearer ${token}`);

  const login = async (): Promise<{ access_token: string; refresh_token: string }> =>
    (await request(app.getHttpServer()).post('/auth/login').send(owner).expect(200)).body;

  beforeAll(async () => {
    app = await createApp({ logger: false });
    await app.init();
    await app
      .get<DataSource>(getDataSourceToken())
      .query(`UPDATE users SET password_hash = $2 WHERE email = $1`, [owner.email, await hashPassword(owner.password)]);
    token = (await login()).access_token;
  });

  afterAll(async () => {
    await app.close();
  });

  const validEntry = {
    account_id: cashAccountId,
    type: 'expense',
    amount_cents: 1250,
    currency: 'UAH',
    booked_at: '2026-08-25T10:00:00.000Z',
    description: 'Lunch',
  };

  it('rejects POST /transactions without Idempotency-Key as problem+json', async () => {
    const res = await api()
      .post('/transactions')
      .send({ entries: [validEntry] });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.detail).toMatch(/idempotency-key/i);
  });

  it('rejects an empty entries batch as a 400 from the validator', async () => {
    const res = await api()
      .post('/transactions')
      .set('Idempotency-Key', `e2e-empty-${randomUUID()}`)
      .send({ entries: [] });

    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.detail).toMatch(/entries/);
  });

  it('creates a transaction and reads the same record back by id', async () => {
    const created = await api()
      .post('/transactions')
      .set('Idempotency-Key', `e2e-create-${randomUUID()}`)
      .send({ entries: [validEntry] });

    expect(created.status).toBe(201);
    expect(created.headers['content-type']).toContain('application/json');
    expect(created.headers['idempotency-replay']).toBeUndefined();

    // A 201 only proves the handler returned. Reading it back through a
    // separate request proves the row was committed, and that what the write
    // path echoed matches what the read path serves from the database.
    const [transaction] = created.body.transactions;
    const fetched = await api().get(`/transactions/${transaction.id}`);

    expect(fetched.status).toBe(200);
    expect(fetched.body).toEqual(transaction);
    expect(fetched.body).toMatchObject({
      account_id: cashAccountId,
      type: 'expense',
      amount_cents: 1250,
      currency: 'UAH',
      booked_at: '2026-08-25T10:00:00.000Z',
      description: 'Lunch',
    });
  });

  it('replays the same 201 for the same key + same body, without creating a new record', async () => {
    const key = `e2e-replay-${randomUUID()}`;
    const first = await api()
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });
    expect(first.status).toBe(201);

    const replay = await api()
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });

    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replay']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('rejects the same key reused with a different body as 422 problem+json', async () => {
    const key = `e2e-reuse-${randomUUID()}`;
    const first = await api()
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [validEntry] });
    expect(first.status).toBe(201);

    const second = await api()
      .post('/transactions')
      .set('Idempotency-Key', key)
      .send({ entries: [{ ...validEntry, amount_cents: 999 }] });

    expect(second.status).toBe(422);
    expect(second.headers['content-type']).toContain('application/problem+json');
    expect(second.body.code).toBe('idempotency-key-reuse');
  });

  it('writes nothing when a later entry in the batch is rejected', async () => {
    // Entry 2 is a `buy` naming an instrument that does not exist. The batch is
    // rejected as a whole, and entry 1 — valid on its own — must not survive it.
    // Two mechanisms have to hold for that: the unknown symbol is rejected up
    // front with a 422 (rather than falling through as a NULL instrument_id and
    // tripping transactions_instrument_matches_type as a 500), and the insert +
    // balance updates share one DB transaction so nothing lands either way.
    const before = await api().get(`/accounts/${cashAccountId}`);
    const balanceBefore = before.body.balance_cents;

    const marker = `rollback-probe-${randomUUID()}`;
    const res = await api()
      .post('/transactions')
      .set('Idempotency-Key', `e2e-rollback-${randomUUID()}`)
      .send({
        entries: [
          { ...validEntry, description: marker },
          {
            account_id: cashAccountId,
            type: 'buy',
            amount_cents: 1000,
            currency: 'UAH',
            booked_at: '2026-08-25T10:00:00.000Z',
            instrument_symbol: 'NOSUCHTICKER',
          },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('instrument-not-found');
    expect(res.body.detail).toContain('NOSUCHTICKER');

    const after = await api().get(`/accounts/${cashAccountId}`);
    expect(after.body.balance_cents).toBe(balanceBefore);

    const listed = await api()
      .get('/transactions')
      .query({ account_id: cashAccountId, limit: 100 });
    expect(
      listed.body.items.filter((t: { description: string }) => t.description === marker),
    ).toHaveLength(0);
  });

  it('paginates GET /accounts with items + next_cursor', async () => {
    const res = await api().get('/accounts').query({ limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('next_cursor');
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('returns 404 problem+json for an unknown account', async () => {
    const res = await api().get(
      `/accounts/${randomUUID()}`,
    );

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(404);
  });

  it('labels fx rates as cacheable and mutable lists as not', async () => {
    // Caching a rate read is safe only because the write path never goes
    // through the controller — TransactionsRepository reads the rate straight
    // from the database — so a stale response cannot reach a stored snapshot.
    const closedDay = await api()
      .get('/fx-rates/USD/latest')
      .query({ on: '2026-01-15' });
    expect(closedDay.status).toBe(200);
    expect(closedDay.headers['cache-control']).toBe('public, max-age=86400');

    // Today's quote may still be published, and the `on`-less URL is the same
    // string tomorrow — so this one must stay short.
    const today = await api().get('/fx-rates/USD/latest');
    expect(today.headers['cache-control']).toBe('public, max-age=60');

    // A 404 means "not published yet"; a backfill can turn it into a 200, and
    // RFC 9111 would otherwise let a cache store it heuristically.
    const missing = await api()
      .get('/fx-rates/EUR/latest')
      .query({ on: '2020-01-01' });
    expect(missing.status).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-store');

    for (const path of ['/accounts', '/transactions']) {
      const listed = await api().get(path).query({ limit: 2 });
      expect(listed.headers['cache-control']).toBe('no-store');
    }
  });

  it('serves currencies from the lookup table', async () => {
    const list = await api().get('/currencies');
    expect(list.status).toBe(200);
    expect(list.body).toEqual(
      expect.arrayContaining([{ code: 'UAH', numeric_code: 980, exponent: 2, name: 'Ukrainian hryvnia' }]),
    );

    const found = await api().get('/currencies/USD');
    expect(found.status).toBe(200);
    expect(found.body).toEqual({ code: 'USD', numeric_code: 840, exponent: 2, name: 'United States dollar' });

    // Well-formed but not in the table: 404, not a validation 400.
    const missing = await api().get('/currencies/ZZZ');
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toContain('application/problem+json');

    const malformed = await api().get('/currencies/usd');
    expect(malformed.status).toBe(400);
  });

  it('answers GET /health without touching the database', async () => {
    const res = await api().get('/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // The response also passed the OpenApiValidator against the Health schema,
    // which is what keeps /health honest about its own shape.
    expect(typeof res.body.uptime_seconds).toBe('number');
    expect(res.body.node_env).toBe('test');
  });

  it('answers 401, not 403, for a protected route without a token', async () => {
    const res = await request(app.getHttpServer()).get('/accounts');

    expect(res.status).toBe(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });

  it('revokes the whole refresh family when a spent refresh token is replayed', async () => {
    const { refresh_token: r1 } = await login();
    const rotated = await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: r1 });
    expect(rotated.status).toBe(200);

    const replay = await request(app.getHttpServer()).post('/auth/refresh').send({ refresh_token: r1 });
    expect(replay.status).toBe(401);

    // The honest client's newer token dies with the family.
    const r2 = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refresh_token: rotated.body.refresh_token });
    expect(r2.status).toBe(401);
  });
});
