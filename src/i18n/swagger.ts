export type Locale = 'en' | 'uk';

export const DEFAULT_LOCALE: Locale = 'en';

const catalog = {
  'info.title': {
    en: 'Invest API',
    uk: 'Invest API',
  },
  'info.description': {
    en: 'Money Manager with detailed investment tracking. The decorator spec is a promise; the runtime validator against openapi.yaml is the guardrail.',
    uk: 'Money Manager з детальним трекінгом інвестицій. Спека з декораторів — обіцянка; runtime-валідатор проти openapi.yaml — запобіжник.',
  },
  'info.server': {
    en: 'Local app with runtime validation against openapi.yaml',
    uk: 'Локальний застосунок з runtime-валідацією проти openapi.yaml',
  },
  'tags.accounts': {
    en: 'Accounts — cash, bank, brokerage, property',
    uk: 'Рахунки — готівка, банк, брокерський рахунок, нерухомість',
  },
  'tags.transactions': {
    en: 'Transactions — income, expenses, transfers, buy and sell',
    uk: 'Транзакції — доходи, витрати, перекази, купівля й продаж активів',
  },
  'errors.badRequest': {
    en: 'Bad request',
    uk: 'Некоректний запит',
  },
  'errors.notFound': {
    en: 'Resource not found',
    uk: 'Ресурс не знайдено',
  },
  'errors.internal': {
    en: 'Internal server error',
    uk: 'Внутрішня помилка сервера',
  },
  'accounts.list.summary': {
    en: 'List accounts',
    uk: 'Список рахунків',
  },
  'accounts.list.badRequest': {
    en: 'Invalid limit or cursor',
    uk: 'Некоректний limit або cursor',
  },
  'accounts.create.summary': {
    en: 'Create account',
    uk: 'Створити рахунок',
  },
  'accounts.create.location': {
    en: 'URI of the created account',
    uk: 'URI створеного рахунку',
  },
  'accounts.create.badRequest': {
    en: 'Request body failed validation',
    uk: 'Тіло не пройшло валідацію',
  },
  'accounts.get.summary': {
    en: 'Get account',
    uk: 'Отримати рахунок',
  },
  'accounts.get.badRequest': {
    en: 'account_id is not a UUID',
    uk: 'account_id не UUID',
  },
  'accounts.get.notFound': {
    en: 'No account with this id',
    uk: 'Рахунок з таким id немає',
  },
  'transactions.list.summary': {
    en: 'List transactions',
    uk: 'Список транзакцій',
  },
  'transactions.list.badRequest': {
    en: 'Invalid limit, cursor, or account_id',
    uk: 'Некоректний limit, cursor або account_id',
  },
  'transactions.list.notFound': {
    en: 'account_id filter points to a missing account',
    uk: 'Фільтр account_id вказує на рахунок, якого немає',
  },
  'transactions.create.summary': {
    en: 'Create transactions as a batch',
    uk: 'Створити транзакції батчем',
  },
  'transactions.create.description': {
    en: 'The batch is applied atomically. Idempotency-Key is required: the same key and body return the same 201 with no second effect.',
    uk: 'Батч застосовується атомарно. Idempotency-Key обовʼязковий: той самий ключ і тіло — той самий 201 без повторного ефекту.',
  },
  'transactions.create.idempotencyKey': {
    en: 'Safe-retry key. The same key and body return the same response plus Idempotency-Replay: true. A different body yields 422. An in-flight request yields 409. TTL is 24 hours.',
    uk: 'Ключ безпечного повтору. Той самий ключ із тим самим тілом повертає ту саму відповідь і заголовок Idempotency-Replay: true. Інше тіло — 422. Запит in-flight — 409. TTL 24 години.',
  },
  'transactions.create.idempotencyReplay': {
    en: 'true when this is a replay of the same key and body',
    uk: 'true, якщо це відтворена відповідь на повтор з тим самим ключем і тілом',
  },
  'transactions.create.badRequest': {
    en: 'Body or Idempotency-Key failed validation',
    uk: 'Тіло або Idempotency-Key не пройшли валідацію',
  },
  'transactions.create.notFound': {
    en: 'One of the accounts in entries does not exist',
    uk: 'Один із рахунків у entries не існує',
  },
  'transactions.create.conflict': {
    en: 'A request with this Idempotency-Key is still in flight',
    uk: 'Запит із цим Idempotency-Key ще виконується',
  },
  'transactions.create.unprocessable': {
    en: 'Idempotency-Key reused with a different body, or currency does not match the account',
    uk: 'Реюз Idempotency-Key з іншим тілом або валюта не збігається з рахунком',
  },
  'transactions.get.summary': {
    en: 'Get transaction',
    uk: 'Отримати транзакцію',
  },
  'transactions.get.badRequest': {
    en: 'transaction_id is not a UUID',
    uk: 'transaction_id не UUID',
  },
  'transactions.get.notFound': {
    en: 'No transaction with this id',
    uk: 'Транзакції з таким id немає',
  },
  'dto.page.limit': {
    en: 'How many records to return on one page.',
    uk: 'Скільки записів повернути на одній сторінці.',
  },
  'dto.page.cursor': {
    en: 'Opaque next-page token from next_cursor. Clients must not parse or construct it.',
    uk: 'Непрозорий токен наступної сторінки з next_cursor. Клієнт не парсить і не конструює його самостійно.',
  },
  'dto.page.nextCursor': {
    en: 'Opaque next-page cursor. null means there are no more pages.',
    uk: 'Непрозорий курсор наступної сторінки. null — сторінок більше немає.',
  },
  'dto.account.balanceCents': {
    en: 'Current balance in cents of the account currency. Integer only: money is never a float.',
    uk: 'Поточний баланс у копійках/центах валюти рахунку. Ціле число: гроші ніколи не float.',
  },
  'dto.account.openingBalance': {
    en: 'Opening balance in cents. Integer only.',
    uk: 'Початковий баланс у копійках/центах. Ціле число.',
  },
  'dto.transactions.accountId': {
    en: 'Show transactions for this account only.',
    uk: 'Показати транзакції лише цього рахунку.',
  },
  'dto.transaction.amountCents': {
    en: 'Amount in cents, always non-negative. Integer only.',
    uk: 'Сума в копійках/центах, завжди невідʼємна. Ціле число.',
  },
  'dto.transaction.bookedAt': {
    en: 'When the operation was booked to the account (ISO 20022 BookingDate) — unlike created_at, which is when the record appeared here.',
    uk: 'Коли операцію проведено по рахунку (BookingDate за ISO 20022) — на відміну від created_at, коли зʼявився сам запис.',
  },
  'dto.transaction.quantityMicro': {
    en: 'Instrument quantity × 10^6. 10 shares = 10000000. null for non-investment types.',
    uk: 'Кількість інструменту × 10^6. 10 акцій = 10000000. null для не-інвестиційних типів.',
  },
  'dto.transaction.entries': {
    en: 'Non-empty list of transactions created atomically.',
    uk: 'Непорожній список транзакцій, які створюються атомарно.',
  },
  'dto.problem.title': {
    en: 'Resource not found',
    uk: 'Ресурс не знайдено',
  },
  'dto.problem.detail': {
    en: 'account 00000000-0000-4000-8000-000000000000 was not found',
    uk: 'рахунок 00000000-0000-4000-8000-000000000000 не знайдено',
  },
  'tags.health': {
    en: 'Health — liveness and database readiness',
    uk: 'Health — живучість процесу і доступність БД',
  },
  'tags.fxRates': {
    en: 'FX rates — currency rate lookups backing transaction snapshots',
    uk: 'Курси валют — довідка по курсах, якими знімки на транзакціях',
  },
  'fxRates.get.summary': {
    en: 'Get latest fx rate',
    uk: 'Отримати останній курс валюти',
  },
  'fxRates.get.badRequest': {
    en: 'currency is not one of UAH/USD/EUR, or on is not a valid date',
    uk: 'currency не UAH/USD/EUR, або on — некоректна дата',
  },
  'fxRates.get.notFound': {
    en: 'No fx rate on or before the given date for this currency',
    uk: 'Немає курсу на задану дату чи раніше для цієї валюти',
  },
  'dto.fxRate.on': {
    en: 'Resolve the rate as of this date (defaults to today). The latest rate on or before it is returned.',
    uk: 'Курс на цю дату (за замовчуванням — сьогодні). Повертається останній курс на цю дату або раніше.',
  },
  'health.liveness.summary': {
    en: 'Liveness probe',
    uk: 'Перевірка живучості процесу',
  },
  'health.db.summary': {
    en: 'Database readiness probe',
    uk: 'Перевірка доступності бази даних',
  },
  'health.db.unavailable': {
    en: 'The database did not answer',
    uk: 'База даних не відповіла',
  },
  'dto.health.uptime': {
    en: 'Process uptime in seconds. It does not reset on a password rotation.',
    uk: 'Час життя процесу в секундах. Ротація пароля його не обнуляє.',
  },
  'dto.health.latency': {
    en: 'Round trip to Postgres in milliseconds.',
    uk: 'Час обігу запиту до Postgres у мілісекундах.',
  },
  'dto.health.probeRows': {
    en: 'Rows read from health_probe — proof the query reached real data.',
    uk: 'Прочитано рядків із health_probe — доказ, що запит дійшов до реальних даних.',
  },
  'dto.health.poolTotal': {
    en: 'Connections currently held by the pool.',
    uk: 'Скільки зʼєднань зараз тримає пул.',
  },
} as const;

export type SwaggerI18nKey = keyof typeof catalog;

export function i18n(key: SwaggerI18nKey, locale: Locale = DEFAULT_LOCALE): string {
  return catalog[key][locale];
}

const TRANSLATABLE_FIELDS = new Set(['summary', 'description', 'title', 'example']);

export function localizeOpenApiDocument<T>(document: T, locale: Locale): T {
  if (locale === DEFAULT_LOCALE) {
    return document;
  }

  const byEnglish = new Map<string, string>();
  for (const entry of Object.values(catalog)) {
    byEnglish.set(entry.en, entry[locale]);
  }

  const cloned = structuredClone(document);
  translateNode(cloned, byEnglish);
  return cloned;
}

function translateNode(node: unknown, byEnglish: Map<string, string>): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      translateNode(item, byEnglish);
    }
    return;
  }
  if (!node || typeof node !== 'object') {
    return;
  }

  const record = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    if (TRANSLATABLE_FIELDS.has(key) && typeof value === 'string') {
      const translated = byEnglish.get(value);
      if (translated) {
        record[key] = translated;
      }
      continue;
    }
    translateNode(value, byEnglish);
  }
}
