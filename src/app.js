const path = require('node:path');
const { randomUUID } = require('node:crypto');
const express = require('express');
const OpenApiValidator = require('express-openapi-validator');
const { idempotency, problem } = require('./idempotency');

// «Невинний рефакторинг» з лекції: віддати внутрішнє camelCase-імʼя назовні.
// Спека при цьому не змінюється — саме це має спіймати validateResponses.
const DRIFT = process.env.DRIFT === '1';

const PROBLEM_BASE = 'https://api.invest.example/problems';
const TITLES = {
  400: 'Некоректний запит',
  404: 'Ресурс не знайдено',
  409: 'Конфлікт зі станом ресурсу',
  422: 'Тіло не пройшло перевірку',
  500: 'Внутрішня помилка сервера',
};

const SIGN = {
  income: 1,
  transfer_in: 1,
  sell: 1,
  expense: -1,
  transfer_out: -1,
  buy: -1,
};

const accounts = new Map();
const transactions = new Map();

function seed() {
  accounts.clear();
  transactions.clear();

  for (const a of [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Готівка UAH',
      type: 'cash',
      currency: 'UAH',
      balance_cents: 350000,
      created_at: '2026-01-10T09:00:00.000Z',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Брокерський IBKR',
      type: 'brokerage',
      currency: 'USD',
      balance_cents: 1250000,
      created_at: '2026-02-01T09:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Квартира на Печерську',
      type: 'property',
      currency: 'USD',
      balance_cents: 9500000,
      created_at: '2026-02-15T09:00:00.000Z',
    },
  ]) {
    accounts.set(a.id, a);
  }

  for (const t of [
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      account_id: '11111111-1111-4111-8111-111111111111',
      type: 'expense',
      amount_cents: 4599,
      currency: 'UAH',
      occurred_at: '2026-08-20T12:30:00.000Z',
      description: 'Кава і сніданок',
      instrument_symbol: null,
      quantity_micro: null,
      created_at: '2026-08-20T12:31:00.000Z',
    },
    {
      id: 'aaaaaaaa-0000-4000-8000-000000000002',
      account_id: '22222222-2222-4222-8222-222222222222',
      type: 'buy',
      amount_cents: 520000,
      currency: 'USD',
      occurred_at: '2026-08-21T14:00:00.000Z',
      description: 'Купівля 10 акцій VOO',
      instrument_symbol: 'VOO',
      quantity_micro: 10000000,
      created_at: '2026-08-21T14:00:05.000Z',
    },
  ]) {
    transactions.set(t.id, t);
  }
}

function encodeCursor(sortKey, id) {
  return Buffer.from(JSON.stringify({ c: sortKey, id })).toString('base64url');
}

function decodeCursor(raw) {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed.c !== 'string' || typeof parsed.id !== 'string') throw new Error();
    return parsed;
  } catch {
    throw problem(400, 'bad-cursor', 'cursor не розпізнано — він непрозорий і належить серверу');
  }
}

// Keyset-пагінація за складеним ключем (sortKey, id), обидва DESC.
function paginate(rows, sortKeyOf, limit, cursor) {
  const sorted = [...rows].sort((a, b) => {
    const ka = sortKeyOf(a);
    const kb = sortKeyOf(b);
    if (ka !== kb) return ka < kb ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  let page = sorted;
  if (cursor) {
    const { c, id } = decodeCursor(cursor);
    page = sorted.filter((r) => {
      const k = sortKeyOf(r);
      return k < c || (k === c && r.id < id);
    });
  }

  const items = page.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    next_cursor: items.length === limit && last ? encodeCursor(sortKeyOf(last), last.id) : null,
  };
}

const toAccount = (a) => ({
  id: a.id,
  name: a.name,
  type: a.type,
  currency: a.currency,
  balance_cents: a.balance_cents,
  created_at: a.created_at,
});

const toTransaction = (t) => ({
  id: t.id,
  account_id: t.account_id,
  type: t.type,
  ...(DRIFT ? { amountCents: t.amount_cents } : { amount_cents: t.amount_cents }),
  currency: t.currency,
  occurred_at: t.occurred_at,
  description: t.description,
  instrument_symbol: t.instrument_symbol,
  quantity_micro: t.quantity_micro,
  created_at: t.created_at,
});

function createApp() {
  seed();

  const app = express();
  app.use(express.json());

  app.use(
    OpenApiValidator.middleware({
      apiSpec: path.join(__dirname, '..', 'openapi', 'openapi.yaml'),
      validateRequests: true,
      validateResponses: true,
    }),
  );

  // Після валідації: ключ не резервується під тіло, яке спека вже відхилила.
  app.use(idempotency);

  app.get('/accounts', (req, res) => {
    const limit = Number(req.query.limit ?? 20);
    const page = paginate([...accounts.values()], (a) => a.created_at, limit, req.query.cursor);
    res.json({ items: page.items.map(toAccount), next_cursor: page.next_cursor });
  });

  app.post('/accounts', (req, res) => {
    const account = {
      id: randomUUID(),
      name: req.body.name,
      type: req.body.type,
      currency: req.body.currency,
      balance_cents: req.body.opening_balance_cents ?? 0,
      created_at: new Date().toISOString(),
    };
    accounts.set(account.id, account);
    res.status(201).location(`/accounts/${account.id}`).json(toAccount(account));
  });

  app.get('/accounts/:account_id', (req, res) => {
    const account = accounts.get(req.params.account_id);
    if (!account) {
      throw problem(404, 'account-not-found', `рахунок ${req.params.account_id} не знайдено`);
    }
    res.json(toAccount(account));
  });

  app.get('/transactions', (req, res) => {
    const { account_id: accountId } = req.query;
    if (accountId && !accounts.has(accountId)) {
      throw problem(404, 'account-not-found', `рахунок ${accountId} не знайдено`);
    }

    const rows = [...transactions.values()].filter((t) => !accountId || t.account_id === accountId);
    const limit = Number(req.query.limit ?? 20);
    const page = paginate(rows, (t) => t.occurred_at, limit, req.query.cursor);
    res.json({ items: page.items.map(toTransaction), next_cursor: page.next_cursor });
  });

  app.post('/transactions', (req, res) => {
    const now = new Date().toISOString();
    const created = [];
    const deltas = new Map();

    for (const entry of req.body.entries) {
      const account = accounts.get(entry.account_id);
      if (!account) {
        throw problem(404, 'account-not-found', `рахунок ${entry.account_id} не знайдено`);
      }
      if (account.currency !== entry.currency) {
        throw problem(
          422,
          'currency-mismatch',
          `валюта ${entry.currency} не збігається з валютою рахунку ${account.id} (${account.currency})`,
        );
      }

      created.push({
        id: randomUUID(),
        account_id: entry.account_id,
        type: entry.type,
        amount_cents: entry.amount_cents,
        currency: entry.currency,
        occurred_at: entry.occurred_at,
        description: entry.description ?? null,
        instrument_symbol: entry.instrument_symbol ?? null,
        quantity_micro: entry.quantity_micro ?? null,
        created_at: now,
      });
      deltas.set(
        entry.account_id,
        (deltas.get(entry.account_id) ?? 0) + SIGN[entry.type] * entry.amount_cents,
      );
    }

    // Комітимо лише після того, як усі entries пройшли перевірку — батч атомарний.
    for (const tx of created) transactions.set(tx.id, tx);
    for (const [id, delta] of deltas) accounts.get(id).balance_cents += delta;

    res.status(201).json({ transactions: created.map(toTransaction) });
  });

  app.get('/transactions/:transaction_id', (req, res) => {
    const tx = transactions.get(req.params.transaction_id);
    if (!tx) {
      throw problem(404, 'transaction-not-found', `транзакцію ${req.params.transaction_id} не знайдено`);
    }
    res.json(toTransaction(tx));
  });

  app.use((err, req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    const body = {
      type: `${PROBLEM_BASE}/${err.code ?? status}`,
      title: TITLES[status] ?? 'Помилка',
      status,
      detail: err.message,
      instance: req.originalUrl,
    };
    if (err.code) body.code = err.code;
    if (Array.isArray(err.errors) && err.errors.length > 0) {
      body.errors = err.errors.map((e) => ({ path: e.path ?? '', message: e.message ?? '' }));
    }

    // send(), а не json(): Content-Type лишається детермінованим і відповідь про помилку
    // не проходить повторно через обгортку response-валідатора.
    res.status(status).type('application/problem+json').send(JSON.stringify(body));
  });

  return app;
}

module.exports = { createApp };
