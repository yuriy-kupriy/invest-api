// Course project: the main contour against the RUNNING compose stack
// (`npm run compose:up` first). One business scenario, every link checked:
//   login (JWT) → POST /transactions/checkout (validation, ownership, guarded debit,
//   order + outbox in one COMMIT) → background: relay → RabbitMQ → consumer issues
//   the receipt → GET /orders/{id} shows it → broker webhook settles the order →
//   GET /orders/{id} shows the settlement. Prints key=value lines, exits non-zero
//   if any link fails. Plain fetch, no build step: it only talks HTTP.
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

const BASE = process.env.API_URL ?? `http://localhost:${process.env.API_HOST_PORT ?? 3000}`;
const env = Object.fromEntries(
  readFileSync(new URL('../.compose/env', import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
);
// The ids seed-dev.ts writes.
const ACCOUNT = '00000099-0000-4000-8000-0000000000a1';
const INSTRUMENT = '00000099-0000-4000-8000-0000000000b1';

async function call(method, path, { token, body, headers = {} } = {}) {
  const raw = body === undefined ? undefined : JSON.stringify(body);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(raw ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: raw,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined };
}

const failures = [];
const check = (key, value, ok) => {
  console.log(`${key}=${value}`);
  if (!ok) failures.push(key);
};

const login = await call('POST', '/auth/login', { body: { email: 'reviewer@example.com', password: env.DEV_USER_PASSWORD } });
check('login', login.status, login.status === 200);
const token = login.body?.access_token;

// A valid request without a token: the OpenAPI validator runs first, so an invalid one would be 400.
const anon = await call('POST', '/transactions/checkout', {
  headers: { 'idempotency-key': randomUUID() },
  body: { account_id: ACCOUNT, instrument_id: INSTRUMENT, quantity: 1, unit_price_cents: 100 },
});
check('anon', anon.status, anon.status === 401);

const invalid = await call('POST', '/transactions/checkout', {
  token,
  headers: { 'idempotency-key': randomUUID() },
  body: { account_id: ACCOUNT, instrument_id: INSTRUMENT, quantity: 0, unit_price_cents: 100 },
});
check('invalid', invalid.status, invalid.status === 400);

const before = (await call('GET', `/accounts/${ACCOUNT}`, { token })).body?.balance_cents;
const key = randomUUID();
const order = { account_id: ACCOUNT, instrument_id: INSTRUMENT, quantity: 2, unit_price_cents: 1500 };
const placed = await call('POST', '/transactions/checkout', { token, headers: { 'idempotency-key': key }, body: order });
check('checkout', placed.status, placed.status === 201);
const replay = await call('POST', '/transactions/checkout', { token, headers: { 'idempotency-key': key }, body: order });
check('replay-same-order', Number(replay.body?.id === placed.body?.id), replay.body?.id === placed.body?.id);
const after = (await call('GET', `/accounts/${ACCOUNT}`, { token })).body?.balance_cents;
check('debited', before - after, before - after === 3000);

const id = placed.body?.id;
let read;
for (let i = 0; i < 40; i++) {
  read = await call('GET', `/orders/${id}`, { token });
  if (read.body?.receipt_issued_at) break;
  await new Promise((r) => setTimeout(r, 250));
}
check('receipt-by-background', Number(Boolean(read.body?.receipt_issued_at)), Boolean(read.body?.receipt_issued_at));

const event = JSON.stringify({ event_id: randomUUID(), order_id: id, amount_cents: placed.body?.amount_cents });
const sign = (secret) => `sha256=${createHmac('sha256', secret).update(event).digest('hex')}`;
const hook = (secret) =>
  fetch(`${BASE}/webhooks/trades`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-signature': sign(secret) },
    body: event,
  }).then(async (r) => ({ status: r.status, outcome: (await r.json()).outcome }));
const forged = await hook('forged-key-forged-key');
check('webhook-forged', forged.status, forged.status === 401);
const first = await hook(env.TRADE_WEBHOOK_SECRET);
check('webhook', first.outcome, first.outcome === 'settled');
const again = await hook(env.TRADE_WEBHOOK_SECRET);
check('webhook-again', again.outcome, again.outcome === 'duplicate');

const final = await call('GET', `/orders/${id}`, { token });
check('final-status', final.body?.status, final.body?.status === 'posted');
check('settled', Number(Boolean(final.body?.settled_at)), Boolean(final.body?.settled_at));

if (failures.length > 0) {
  console.error(`CONTOUR FAILED: ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`contour=ok order=${id}`);
