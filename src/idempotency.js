const { createHash } = require('node:crypto');

const TTL_MS = 24 * 60 * 60 * 1000;

// In-memory, тобто втрачається на рестарті. У ДЗ #14 ключ переїде в ту саму транзакцію БД,
// що й сам ефект — інакше це dual write і ключ може лягти без операції.
const store = new Map();

function fingerprint(body) {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

function problem(status, code, detail) {
  const err = new Error(detail);
  err.status = status;
  err.code = code;
  return err;
}

function idempotency(req, res, next) {
  const key = req.headers['idempotency-key'];
  if (req.method !== 'POST' || !key) return next();

  const fp = fingerprint(req.body);

  let rec = store.get(key);
  if (rec && rec.expiresAt <= Date.now()) {
    store.delete(key);
    rec = undefined;
  }

  if (rec) {
    if (rec.fingerprint !== fp) {
      return next(
        problem(
          422,
          'idempotency-key-reuse',
          'Idempotency-Key уже використано з іншим тілом запиту — один ключ належить одній операції',
        ),
      );
    }
    if (rec.state === 'in-flight') {
      return next(
        problem(
          409,
          'idempotency-in-flight',
          'Запит із цим Idempotency-Key ще виконується — повторіть спробу згодом',
        ),
      );
    }
    res.setHeader('Idempotency-Replay', 'true');
    return res.status(rec.status).json(rec.body);
  }

  store.set(key, { state: 'in-flight', fingerprint: fp, expiresAt: Date.now() + TTL_MS });

  let captured;
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    captured = body;
    return originalJson(body);
  };

  // Фіксуємо за фактичним статусом уже після відправки: якщо response-валідація завалила
  // відповідь, ключ не має лишитися в store як успішний.
  res.on('finish', () => {
    if (res.statusCode === 201) {
      store.set(key, {
        state: 'done',
        fingerprint: fp,
        status: 201,
        body: captured,
        expiresAt: Date.now() + TTL_MS,
      });
    } else {
      store.delete(key);
    }
  });

  next();
}

module.exports = { idempotency, problem };
