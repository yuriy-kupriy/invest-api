# invest-api — ДЗ #9: OpenAPI-спека курсового проєкту + runtime-валідація на кордоні

Курсовий проєкт Node.js PRO 2. Це ДЗ №1 курсового: спека стає джерелом правди API.

**Обраний варіант contract-частини — Б: runtime-валідація на кордоні** через
[`express-openapi-validator`](https://github.com/cdimascio/express-openapi-validator) 5.

---

## Домен

**Money Manager з детальним трекінгом інвестицій.**

Рахунки й інвестиції — не дві підсистеми, а одна модель, у якій тип задається enum-ом:

| Сутність | Тип | Значення |
|---|---|---|
| `Account` | `type` | `cash`, `bank`, `brokerage`, `property` |
| `Transaction` | `type` | `income`, `expense`, `transfer_in`, `transfer_out`, `buy`, `sell` |

A brokerage account is `account.type = brokerage`; buying securities is `transaction.type = buy`
з заповненими `instrument_symbol` і `quantity_micro`. Нерухомість — `account.type = property`.
Переказ між власними рахунками — дві транзакції (`transfer_out` + `transfer_in`) в **одному
атомарному батчі**; саме тому операція створення транзакцій приймає масив, а не один запис.

---

## Швидкий старт

```bash
npm install
npm start          # http://localhost:3000 · Swagger UI: /docs · UK: /docs/uk
```

Даних у БД немає — сховище in-memory, сідується трьома рахунками й двома транзакціями на старті.

| Account | id | Currency |
|---|---|---|
| Cash UAH (`cash`) | `11111111-1111-4111-8111-111111111111` | UAH |
| IBKR brokerage (`brokerage`) | `22222222-2222-4222-8222-222222222222` | USD |
| Apartment in Pechersk (`property`) | `33333333-3333-4333-8333-333333333333` | USD |

---

## Структура

| Шлях | Призначення |
|---|---|
| `openapi/openapi.yaml` | **спека — джерело правди**: 2 ресурси, 6 операцій, cursor-пагінація, Idempotency-Key, problem+json |
| `src/main.ts` | точка входу: Express adapter, OpenAPI-валідатор, Swagger `/docs` і `/docs-json`, error-handler у problem+json |
| `src/app.module.ts` | корінь: feature-модулі, Idempotency-Key middleware, глобальний exception filter |
| `src/accounts/` | NestJS controller / service / in-memory repository рахунків |
| `src/transactions/` | NestJS controller / service / in-memory repository транзакцій |
| `src/shared/` | пагінація, мапери (`DRIFT`), idempotency, problem+json |
| `src/domain/` | типи `Account` / `Transaction` |
| `src/create-app.ts` | збірка Nest-застосунку (валідатор, pipes, error-handler) — спільна для `main.ts` і e2e-тестів |
| `test/e2e/app.e2e-spec.ts` | e2e: той самий пайплайн, що й `npm start`, без реального `listen()` |
| `scripts/check-spec.js` | перевірка обсягу спеки — той самий скрипт, що в acceptance criteria |

---

## Тести

```bash
npm test          # юніт: контролери/сервіси з мокнутим репозиторієм — 46 тестів
npm run test:e2e  # e2e: реальний пайплайн (validateRequests/Responses, Idempotency-Key,
                   # problem+json) через supertest, без мережевого порту — 11 тестів
```

Юніт-специ лежать поруч із кодом (`src/**/*.spec.ts`) — стандартна Nest CLI-конвенція.
E2e — окремо в `test/e2e/`, зі своїм `test/e2e/jest-e2e.json`, теж за замовчуванням Nest CLI:
e2e піднімає ціле дерево модулів разом із raw-Express шаром (`OpenApiValidator`,
error-handler), який юніт-тести контролерів навмисно обходять моком сервісу.

Повна картина шарів — integration на testcontainers, E2E і контракт — у розділі
[ДЗ #16](#домашнє-завдання-16--драбинка-довіри-testcontainers-e2e-pact).

---

## API

| Метод | Шлях | operationId |
|---|---|---|
| GET | `/accounts` | `listAccounts` — cursor-пагінація |
| POST | `/accounts` | `createAccount` |
| GET | `/accounts/{account_id}` | `getAccount` |
| GET | `/transactions` | `listTransactions` — cursor-пагінація + фільтр `account_id` |
| POST | `/transactions` | `createTransactions` — **Idempotency-Key обовʼязковий**, батч |
| GET | `/transactions/{transaction_id}` | `getTransaction` |

---

## Рішення контракту

**Гроші — цілі копійки.** `amount_cents`, `balance_cents` — `integer`/`int64`. Ніяких float і ніяких
рядків-decimal `"2600.00"`: це біль v1 з лекції, і повторювати його у власній v1 немає сенсу.
Валюта завжди окремим явним полем — enum `UAH` / `USD` / `EUR`.

**Кількість інструменту — `quantity_micro`**, ціле число × 10⁶. Дробові акції (10.5 шт = `10500000`)
теж не стають float.

**Формат на дроті — `snake_case`**, внутрішні імена — окремо. Саме на цьому шві виникає дрейф, і саме
його ловить `validateResponses` (див. розділ «Доказ»).

**Курсорна пагінація.** `limit` + `cursor` на списках, відповідь — `{ items, next_cursor }`,
`next_cursor: null` означає, що сторінок більше немає. Курсор **непрозорий**: у спеці прямо написано,
що його структура належить серверу й клієнт не має права його парсити. Всередині — base64url від
`{ c: <ключ сортування>, id }`, keyset за складеним ключем `(booked_at, id) DESC`.

**Idempotency-Key — `required: true`** на `POST /transactions`. Стандарту на цей заголовок немає
(IETF-draft `draft-ietf-httpapi-idempotency-key-header` зупинився на ревізії -07 і прострочений),
тому семантика описана в спеці явно й слідує Stripe:

| Випадок | Результат |
|---|---|
| ключ уперше | операція виконується, `201` |
| той самий ключ + **те саме** тіло | `201` + `Idempotency-Replay: true`, обробник не виконується, нових записів немає |
| той самий ключ + **інше** тіло | `422` `idempotency-key-reuse` |
| ключ у стані `in-flight` | `409` `idempotency-in-flight` |
| ключ старший за 24 год | вважається новим |

Тіло звіряється по `sha256(JSON.stringify(body))`.

**`security: []` на корені.** Авторизації в API поки свідомо немає — вона зʼявиться в ДЗ #24
(JWT + RBAC). Явний порожній список — це не заглушка, а декларація «цей API навмисно відкритий»;
без нього redocly-правило `security-defined` дає **error** і `lint` завершується з exit 1.

**problem+json (RFC 9457) як єдиний контракт помилок.** Схема `Problem` з обовʼязковими
`type` / `title` / `status` / `detail` / `instance`, плюс розширення `code` і `errors[]`.
Спільні `components.responses` (`BadRequest`, `NotFound`, `Conflict`, `Unprocessable`,
`InternalError`) перевикористовуються всіма операціями.

### Дві пастки, на які варто зважати при читанні спеки

1. **Параметри описані inline, а не через `$ref`.** Це виглядає багатослівно, але зроблено свідомо:
   перевірка обсягу читає `paths[p][m].parameters` зі **збандленої** спеки, а `redocly bundle`
   внутрішні `$ref` на `components.parameters` не розкриває (для цього потрібен `--dereferenced`).
   З `$ref` параметр приїхав би як `{$ref: '#/...'}` без поля `in`, і `required` був би `undefined`.
   На `components.responses` це не поширюється — там перевикористання безпечне.
2. **У `Problem` не стоїть `additionalProperties: false`.** Інакше `validateResponses: true`
   завалював би власні ж відповіді про помилки, щойно в них зʼявляються розширення `code`/`errors`.

---

## Пункт 5: хто звіряє

Спека сама по собі нічого не примушує. Примушує ось це, у `src/main.ts`:

```js
OpenApiValidator.middleware({
  apiSpec: path.join(__dirname, '..', 'openapi', 'openapi.yaml'),
  validateRequests: true,
  validateResponses: true,
})
```

`validateRequests` відхиляє все, що суперечить спеці, **на вході** — включно з відсутнім
`Idempotency-Key`, порожнім `entries` і зайвими полями в тілі. `validateResponses` — рантайм-аналог
`contract/check.mjs` з лекції: він фізично не дає віддати відповідь, що суперечить спеці.

Порядок middleware має значення:

```
express.json()
  → OpenApiValidator.middleware()   ← валідація запиту
  → IdempotencyMiddleware           ← після неї: ключ не резервується під тіло, яке спека відхилила
  → NestJS controller → service → in-memory repository
  → exception filter / Express error handler → problem+json
```

Error-handler віддає помилку через `res.type('application/problem+json').send(JSON.stringify(body))`,
а не `res.json()` — так `Content-Type` детермінований і відповідь про помилку не проходить повторно
через обгортку response-валідатора.

### Чому не Fastify

Готового рішення «з коробки» для Fastify немає. Усі spec-first роутери
(`fastify-openapi-glue`, форк Platformatic, `@uphold/fastify-openapi-router-plugin`) віддають
`schema.response` у `fast-json-stringify` — а це **серіалізатор, не валідатор**: він мовчки викидає
зайві поля, коерсить типи й ігнорує `minItems`/`enum`/`maxLength`, ловлячи лише відсутнє `required`.
Тобто дрейф, заради якого існує пункт 5, частково проходив би повз. Діру закриває
`@fastify/response-validation`, але цю зв'язку ніхто не документує разом — інтеграція, `strict: false`
для OpenAPI 3.0, вимкнення `removeAdditional` і власний тест на неї лягають на автора.
`fastify-openapi-validator` в npm — покинутий форк 2021 року.

`express-openapi-validator` дає обидва напрямки одним пакетом прямо з `openapi.yaml`.

---

## Acceptance criteria — команди й фактичний вивід

Усе працює після чистої установки: `rm -rf node_modules && npm install`, жодних ручних кроків.

### 1. Спека валідна

```bash
npx @redocly/cli lint openapi/openapi.yaml; echo "exit=$?"
```
```
openapi/openapi.yaml: validated in 125ms
Woohoo! Your API description is valid. 🎉
You have 2 warnings.
exit=0
```
Два warning — `info-license-strict` (немає URL ліцензії) і `no-server-example.com` (сервер вказує
на localhost). Warnings дозволені, errors немає.

### 2. Обсяг спеки

```bash
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node -e "const s=require('./spec.json'),M=['get','post','put','patch','delete'];const ops=Object.entries(s.paths).flatMap(([p,v])=>Object.keys(v).filter(m=>M.includes(m)).map(m=>[p,m]));const idem=ops.flatMap(([p,m])=>s.paths[p][m].parameters??[]).find(x=>x.in==='header'&&/idempotency-key/i.test(x.name));console.log('операцій:',ops.length,'· ресурсів:',new Set(Object.keys(s.paths).map(p=>p.split('/')[1])).size);console.log('Idempotency-Key: required =',idem?.required,'· опис, символів =',(idem?.description??'').trim().length)"
```
```
операцій: 6 · ресурсів: 2
Idempotency-Key: required = true · опис, символів = 608
```

Те саме одним рядком: `npm run check:spec` (lint + bundle + ці ж перевірки з ненульовим exit-кодом
при провалі).

### 3–5. grep-перевірки

```bash
grep -c 'Idempotency-Key' openapi/openapi.yaml          # 5   (треба ≥ 1)
grep -c 'next_cursor' openapi/openapi.yaml              # 6   (треба ≥ 1)
grep -c 'application/problem+json' openapi/openapi.yaml # 7   (треба ≥ 2)
```

### 6. Contract-частина працює — варіант Б

`npm start`, далі:

**Без `Idempotency-Key` → 400 `application/problem+json`.** Заголовок вимагає спека, а не `if` у коді:

```bash
curl -i -X POST localhost:3000/transactions -H 'content-type: application/json' \
  -d '{"entries":[{"account_id":"11111111-1111-4111-8111-111111111111","type":"expense","amount_cents":1250,"currency":"UAH","booked_at":"2026-08-25T10:00:00.000Z"}]}'
```
```
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json; charset=utf-8

{
  "type": "https://api.invest.example/problems/400",
  "title": "Некоректний запит",
  "status": 400,
  "detail": "request/headers must have required property 'idempotency-key'",
  "instance": "/transactions",
  "errors": [{ "path": "/headers/idempotency-key", "message": "must have required property 'idempotency-key'" }]
}
```

> Заголовок у `detail` — з маленької літери (`idempotency-key`), бо валідатор нормалізує
> header-параметри до lowercase у `req.headers`. У спеці він написаний канонічно: `Idempotency-Key`.

**Невалідне тіло (порожній масив) → 400 з деталлю від валідатора:**

```bash
curl -X POST localhost:3000/transactions -H 'content-type: application/json' \
  -H 'Idempotency-Key: hw09-empty-001' -d '{"entries":[]}'
```
```
"detail": "request/body/entries must NOT have fewer than 1 items"
```

> **Про `entries` vs `items`.** В acceptance criteria наведено детайл із чернетки-Marketplace:
> `request/body/items must NOT have fewer than 1 items`. У цьому домені поле батчу зветься
> `entries` (це список транзакцій, а `items` зайняте під елементи сторінки пагінації), тож
> валідатор пише `entries`. Це рівно та сама Ajv-перевірка `minItems: 1` — слово «items» у
> кінці рядка йде з формулювання Ajv, а не з назви поля.

**Валідний запит → 201:**

```bash
curl -i -X POST localhost:3000/transactions -H 'content-type: application/json' \
  -H 'Idempotency-Key: hw09-replay-0001' \
  -d '{"entries":[{"account_id":"11111111-1111-4111-8111-111111111111","type":"expense","amount_cents":1250,"currency":"UAH","booked_at":"2026-08-25T10:00:00.000Z","description":"Обід"}]}'
```
```
HTTP/1.1 201 Created
Content-Type: application/json; charset=utf-8
```
Баланс рахунку: `350000 → 348750`.

Додатково відхиляється зайве поле в тілі (бо `additionalProperties: false`):
```
"detail": "request/body/entries/0 must NOT have additional properties"
```

### Додатковий виклик: повна семантика Idempotency-Key

**Той самий ключ + те саме тіло → той самий 201 + `Idempotency-Replay: true`:**
```
HTTP/1.1 201 Created
Idempotency-Replay: true
```
Баланс лишається `348750` — обробник не виконувався, друга транзакція не створена.

**Той самий ключ + інше тіло → 422 problem+json:**
```json
{
  "type": "https://api.invest.example/problems/idempotency-key-reuse",
  "title": "Тіло не пройшло перевірку",
  "status": 422,
  "detail": "Idempotency-Key уже використано з іншим тілом запиту — один ключ належить одній операції",
  "instance": "/transactions",
  "code": "idempotency-key-reuse"
}
```

### Доказ, що валідатор справді звіряє (рантайм-аналог `DRIFT=1` з лекції)

Прапорець `DRIFT=1` змушує мапер віддати внутрішнє camelCase-імʼя назовні — «невинний рефакторинг»
`amount_cents → amountCents`. **Спека при цьому не змінюється.**

```bash
DRIFT=1 npm start
curl -i localhost:3000/transactions/aaaaaaaa-0000-4000-8000-000000000002
```
```
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json; charset=utf-8

{
  "type": "https://api.invest.example/problems/500",
  "title": "Внутрішня помилка сервера",
  "status": 500,
  "detail": "/response must have required property 'amount_cents'",
  "instance": "/transactions/aaaaaaaa-0000-4000-8000-000000000002",
  "errors": [{ "path": "/response/amount_cents", "message": "must have required property 'amount_cents'" }]
}
```

Це і є суть пункту 5: сервер не «сам не віддає зайвого» — його **не пускає** валідатор на кордоні.

### Інші перевірені сценарії

| Сценарій | Результат |
|---|---|
| `GET /accounts?limit=2` → перехід за `next_cursor` | друга сторінка, `next_cursor: null` |
| битий курсор | `400` `bad-cursor` |
| неіснуючий рахунок / транзакція | `404` problem+json |
| батч, де друга entry має неіснуючий рахунок | `404`, **жодна** транзакція не створена (атомарність) |
| валюта entry ≠ валюта рахунку | `422` `currency-mismatch` |
| переказ `transfer_out` + `transfer_in` одним батчем | `201`, обидва баланси зсунулись на 50000 |

---

## Маппінг домену на пізніші ДЗ

Формального припису щодо домену в матеріалах немає — ДЗ скрізь дають Marketplace як приклад
(«**наприклад**, оформлення замовлення»), а `course-project-spec.md`, на який посилається лекція 34,
у репозиторії курсу відсутній. Але два ДЗ названі через Marketplace-лексику текстуально, тому
маппінг фіксую тут явно:

| ДЗ | Формулювання в курсі | У цьому проєкті |
|---|---|---|
| #24 | «RBAC-гарди на ресурси (orders / products)» | гарди на `accounts` / `transactions`; ролі — власник, партнер (read-write на спільний рахунок), радник (read-only). ReBAC-бонус — кортежі шерингу рахунку |
| #26 | «фото товарів / аватарки» | фото обʼєктів нерухомості, PDF-виписки брокера (це і є «великий файл» під multipart), чеки до витрат, аватарки. CDN — над приватними обʼєктами з підписаними URL |
| #23 | «hot data» під cache-aside | курси валют і котирування інструментів: спільні для всіх користувачів, TTL обґрунтований доменом, зовнішній провайдер — реальна ціль rate-limit; BullMQ-scheduler — щоденний фетч котирувань |
| #14 | «оформлення замовлення з декрементом stock» | атомарний батч транзакцій із перерахунком балансів — уже задекларований тут `POST /transactions` |
| #16 | Pact + integration/E2E | консюмер провайдера котирувань; contract-тести проти цієї ж спеки |

---

## Що свідомо НЕ описано у спеці

Спека описує тільки те, що реалізовано. Пʼять чесних операцій кращі за двадцять вигаданих —
наступні ДЗ будуються саме по цьому файлу.

- `/instruments`, `/quotes`, `/holdings` — зʼявляться в ДЗ #23 разом із кешем і зовнішнім провайдером.
- URI-версіонування (`/v1`) — не потрібне цьому ДЗ; версія живе в `info.version`.
- Автентифікація — ДЗ #24, зараз `security: []`.
- Pact — це варіант А; консюмер-контракт іде в ДЗ #16, де лекція прямо каже «верифікує
  OpenAPI-spec з ДЗ #9».
- БД — доменне сховище лишається in-memory; Postgres підключений як керований ресурс
  (пул + `/health/db`) заради ДЗ #2 курсового, доменна схема проєктується в ДЗ #12.

---


# ДЗ #2 курсового: Configuration

Другий крок курсового: конфігурація перестає бути «читаємо `process.env` де захочеться».
Замикаються два ланцюги —

```
process.env → zod-схема (fail-fast) → ConfigService<Env, true> → код
secrets/db_password → password: () => readFile() → pg.Pool → Postgres
```

— і другий доводиться **ротацією пароля БД без рестарту сервісу**.

## Змінні середовища

Джерело правди — [`src/config/env.schema.ts`](src/config/env.schema.ts). Контракт для людей —
[`.env.example`](.env.example) (у git, зі фейковими значеннями). Реальний `.env` — у `.gitignore`
і в `.dockerignore`.

| Змінна | Обовʼязкова | Дефолт | Тип у схемі | **Джерело** | Призначення |
|---|---|---|---|---|---|
| `NODE_ENV` | ні | `development` | `enum(development, test, production)` | оточення | режим роботи |
| `PORT` | ні | `3000` | `coerce.number().int()` 1…65535 | оточення | порт HTTP |
| `DB_URL` | **так** | — | `url()`, лише `postgres://`, **без пароля** | **сховище** — значення в `.env` (у git лише `.env.example` з фейковим), пароль окремо зі сховища секретів `secrets/db_password` через `DB_PASSWORD_FILE` | хост/порт/користувач/база **цього ДЗ** |
| `DB_PASSWORD_FILE` | ні | `./secrets/db_password` | непорожній рядок | оточення | шлях до файла-секрета |
| `DB_POOL_MAX` | ні | `10` | `coerce.number().int()` 1…50 | оточення | розмір пулу `pg` |
| `DB_CONNECT_TIMEOUT_MS` | ні | `5000` | `coerce.number().int()` ≥100 | оточення | таймаут конекту |
| `DRIFT` | ні | `0` | `enum('0','1')` | оточення | навмисний дрейф мапера з ДЗ #9 |

Рядок підключення застосунку живе в тому самому сховищі, що й із ДЗ #11, і вказує на базу ДЗ #12
(`postgres://invest_app@localhost:5433/invest`). Нового env-файла під нього не заводилось: у git
трекається лише `.env.example`, і жоден інший трекнутий env-файл змінної підключення не містить.
Дев-креденшели самого контейнера Postgres — це окремий шлях: вони лишаються в
[`docker-compose.yml`](docker-compose.yml) відкритим текстом, бо не є секретом і потрібні грейдеру,
щоб підняти стенд зі свіжого клону.

Три речі, які тут не випадкові:

- **`z.coerce.number()`, а не `z.number()`** — з середовища все приходить рядком.
- **`DRIFT` — це `enum('0','1')`, а не boolean**: `Boolean('0') === true`, тож `coerce.boolean()`
  тихо вмикав би прапорець назавжди.
- **`DB_URL` не містить пароля** — схема це прямо перевіряє (`refine`). Пароль — секрет, він живе
  у файлі, який перечитується на кожне нове зʼєднання.

Валідація підключена в [`app.module.ts`](src/app.module.ts) першим імпортом:

```ts
ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['.env'], validate: validateEnv })
```

`validate` викликається **до** побудови DI-графа, тож [`env.validation.ts`](src/config/env.validation.ts)
робить один `safeParse` і кидає помилку зі списком **усіх** зламаних змінних одразу, а не по одній.
У коді немає жодного `process.env` поза схемою — перевіряється як `grep -rn 'process\.env' src`.

## Як запустити

```bash
npm install
cp .env.example .env          # і за потреби поправити значення
npm run db:up                 # Postgres у docker compose
npm run secrets:init          # кладе стартовий пароль у secrets/db_password
npm start                     # build + node dist/main.js
```

`start` навмисно **не** watch-режим: `nest start --watch` не завершується й не віддає exit code,
тож на ньому не перевірити fail-fast. Watch живе окремо — `npm run start:dev`.

Про порти: compose віддає Postgres на **5433** (`POSTGRES_HOST_PORT` перевизначає), бо 5432 на хості
часто зайнятий локально встановленим сервером — тому `DB_URL` у `.env.example` вказує саме на 5433.
Порт застосунку так само конфігурований: `PORT=3100 npm start`.

Корисне поруч:

| Команда | Що робить |
|---|---|
| `npm run check:env` | звіряє `.env.example` зі схемою, `exit 1` якщо файл відстав |
| `npm run check:spec` | перевірки ДЗ #9: lint + bundle + обсяг спеки |
| `npm run db:up` / `npm run db:down` | підняти / знести Postgres (`down -v` стирає том!) |
| `npm run secrets:init` | створити файл-секрет зі стартовим паролем |
| `npm run rotate` | ротація пароля БД без рестарту |

Health-ендпоїнти (обидва описані у спеці, тож ідуть через той самий response-валідатор):

| Ендпоїнт | Що показує |
|---|---|
| `GET /health` | `uptime_seconds` процесу, версія, `node_env`. БД **не** чіпає |
| `GET /health/db` | справжній запит до Postgres: `latency_ms`, `now`, `probe_rows`, стан пулу |

## Ротація пароля БД без рестарту

Пароль ніколи не буває змінною середовища. Пул створюється у [`db.module.ts`](src/db/db.module.ts)
з паролем-**функцією**:

```ts
password: async () => (await readFile(absolutePath, 'utf8')).trim(),
```

`pg` викликає її на **кожне нове зʼєднання** — саме тому оновлення файла достатньо, щоб новий
пароль поїхав у справу без перезапуску процесу.

```bash
curl -s localhost:3000/health | jq .uptime_seconds     # запамʼятати
npm run rotate                                          # або: bash rotate.sh
curl -s localhost:3000/health/db | jq .                 # 200 — пул автентифікувався заново
curl -s localhost:3000/health | jq .uptime_seconds     # більше за попереднє → рестарту не було
```

Що робить [`rotate.sh`](rotate.sh) і чому саме в такому порядку:

1. `ALTER ROLE invest_app WITH PASSWORD …` — нове значення дійсне в БД;
2. **одразу** запис у `secrets/db_password` через тимчасовий файл + `mv` (підміна атомарна, паралельне
   зʼєднання не прочитає напівзаписаний пароль). Вікно між (1) і (2) — єдине, коли нове зʼєднання
   взяло б старий пароль; нульове вікно дають alternating users (AWS rotation strategies), тут
   свідомо простіша однокористувацька схема;
3. `pg_terminate_backend` для решти зʼєднань ролі — старі клієнти рвуться, пул відкриває нові вже
   з новим паролем.

Після кроку 3 пул емітить `'error'` на вбитих клієнтах. Обробник `pool.on('error', …)` у
`db.module.ts` **обовʼязковий**: без нього це unhandled `'error'` і процес падає — це не баг
ротації, це відсутній обробник.

**Пастка `docker compose down -v`.** Том стирається, Postgres переінʼється з `db/init.sql` і
повертається до стартового пароля, а `secrets/db_password` лишається з ротованим — далі
`password authentication failed`. Лікується так:

```bash
FORCE=1 npm run secrets:init
```

## Секрети поза git і поза образом

- `.gitignore` — `.env` і вся тека `secrets/`; у git лежить лише `.env.example`.
- [`.dockerignore`](.dockerignore) — `.env*`, `secrets/`, `node_modules`, `dist`, `.git`, `.idea`.
- [`Dockerfile`](Dockerfile) — single-stage, **без жодної інструкції `ENV`**: усе, що покаже
  `docker inspect --format '{{.Config.Env}}'`, належить базовому образу. Конфіг приходить у
  рантаймі (`--env-file`), секрет — томом.

```bash
docker build -t myapp .
docker run --rm myapp ls -a /app                        # є .env.example, немає .env і secrets/
docker run --rm myapp sh -c 'cat /app/.env' 2>&1        # No such file or directory
docker inspect --format '{{.Config.Env}}' myapp          # лише PATH, NODE_VERSION, YARN_VERSION
docker history --no-trunc myapp | grep -i password      # порожньо
```

## Структура ДЗ #2

| Шлях | Призначення |
|---|---|
| `src/config/env.schema.ts` | zod-схема — єдине джерело правди про змінні |
| `src/config/env.validation.ts` | `validate` для `ConfigModule`: усі помилки одним списком |
| `src/db/db.module.ts` | `pg.Pool` з паролем-функцією + `pool.on('error')` |
| `src/health/` | `/health` (uptime) і `/health/db` (реальний запит у БД) |
| `.env.example` | контракт змінних у git, значення фейкові |
| `scripts/check-env-example.mjs` | звірка `.env.example` зі схемою (`npm run check:env`) |
| `scripts/init-secret.sh` | стартовий пароль у `secrets/db_password` |
| `rotate.sh` | ротація: ALTER ROLE → файл → `pg_terminate_backend` |
| `docker-compose.yml`, `db/init.sql` | Postgres, роль `invest_app`, таблиця `health_probe` |
| `Dockerfile`, `.dockerignore` | образ без секретів і без власних `ENV` |


---

# ДЗ #12 курсового: доменна схема, курси валют, індекси

Третій крок курсового: БД перестає бути «керованим ресурсом заради health-чеку» й отримує доменну
схему. Її ж успадкують ДЗ #13 (TypeORM-міграції), #14 (транзакції) і #15 (pooling і бекапи).

**Головна таблиця — `transactions`**, після seed у ній **500 000 рядків**.

## Підняти базу й підключитись

Підняти Postgres — один рядок, працює на свіжому клоні без правок файлів:

```bash
docker compose up -d --wait postgres
```

Підключитись — один рядок:

```bash
docker compose exec postgres psql -U postgres -d invest
```

Неінтерактивний варіант того самого (`docker compose exec -T postgres psql -U postgres -d invest
-Atc "SELECT 1"`) друкує `1`.

Пароль ніде не треба вгадувати: дев-креденшели стенда (`postgres` / `postgres`) лежать відкритим
текстом у [`docker-compose.yml`](docker-compose.yml) — вони не секрет, і потрібні саме для того,
щоб база піднімалась зі свіжого клону. Пароль **застосунку** (роль `invest_app`) — окремий шлях:
він живе у `secrets/db_password`, у git його немає, а в репозиторії лежить лише
[`secrets/db_password.example`](secrets/db_password.example) зі стартовим дев-значенням.

### pgAdmin — GUI для БД (опційно, dev-only)

Не в `docker compose up -d --wait`: грейдеру зайвий контейнер ні до чого, тож піднімається окремим
[Compose profile](https://docs.docker.com/compose/how-tos/profiles/):

```bash
docker compose --profile tools up -d pgadmin
```

Далі — <http://localhost:5050>, без логіну (pgAdmin у desktop-режимі). Сервер **«invest (docker)»**
вже зареєстрований ([`pgadmin/servers.json`](pgadmin/servers.json)) і під'єднується без жодного
запиту пароля —
[`pgadmin/pgpass`](pgadmin/pgpass) містить ті самі дев-креденшели `postgres`/`postgres`, що вже
відкритим текстом у `docker-compose.yml` вище, тож жодного нового секрету тут немає. Файл
передається через `PGPASS_FILE`, а не монтується туди, де його читає libpq: git зберігає його з
правами `0644`, а libpq ігнорує password file з доступом для group/world — зі свіжого клону
pgAdmin питав би пароль. Entrypoint образу сам копіює його в `/var/lib/pgadmin/.pgpass` з `0600`
(лише при першій ініціалізації — після зміни `pgpass` треба перестворити том `pgadmin_data`).

`docker compose down -v` (пастка з розділу вище) заразом стирає й `pgadmin_data` — саме
налаштування pgAdmin (не дані Postgres), тому при наступному підйомі `servers.json` просто
переімпортується заново, без жодних дій руками.

## Повний прогін — рівно ці команди

Файли з `db/` подаються в контейнер через stdin, тому нічого монтувати не треба:

```bash
docker compose down -v && docker compose up -d --wait postgres
docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/schema.sql
docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/seed.sql
for q in 1 2 3; do docker compose exec -T postgres psql -U postgres -d invest -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"; done
docker compose exec -T postgres psql -U postgres -d invest -v ON_ERROR_STOP=1 -f - < db/indexes.sql
docker compose exec -T postgres psql -U postgres -d invest -c "ANALYZE;"
for q in 1 2 3; do docker compose exec -T postgres psql -U postgres -d invest -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$q.sql)"; done
```

До `db/indexes.sql` кожен із трьох планів містить `Seq Scan`; після — `Index Scan` і жодного
`Seq Scan`. `db/seed.sql` наливає 500k транзакцій приблизно за 40 секунд.

## Схема — 7 таблиць, 8 FOREIGN KEY

| Таблиця | Рядків | Призначення |
|---|---|---|
| `currency` | 3 | довідник ISO 4217: `code`, `numeric_code` (r030), `exponent`, `name` |
| `users` | 20 000 | власники рахунків |
| `accounts` | 60 000 | рахунки: `cash` / `bank` / `brokerage` / `property` |
| `instruments` | 500 | інструменти: `equity` / `etf` / `bond` / `crypto` |
| `categories` | 24 | категорії доходів і витрат |
| `fx_rate` | 1 568 | курс валюти на дату, з джерелом у ключі |
| **`transactions`** | **500 000** | **головна таблиця** |

Перекоси в даних навмисні — на рівномірному розподілі `EXPLAIN` нічого не покаже:

| Поле | Розподіл |
|---|---|
| `status` | `posted` 97.02% · `pending` 2.18% · `failed` 0.80% |
| `type` | `expense` 55.09% · `income` 20.00% · `transfer_out` 7.98% · `transfer_in` 7.97% · `buy` 6.00% · `sell` 2.96% |
| `currency` | UAH 71.22% · USD 19.23% · EUR 9.55% |
| транзакцій на рахунок | степеневий закон: найгарячіший рахунок тримає 12 897 операцій, медіанний — одиниці |

`db/seed.sql` відтворюваний: id, назви рахунків і всі псевдовипадкові рішення — чисті функції від
номера рядка (`md5` з міткою, нормований у `[0, 1)`), тож літерали в `db/queries/*.sql` не
«протухають» після пере-сіду.

> Тут була пастка, на якій легко втратити вечір: підзапит `LATERAL (SELECT random() …)`, що не
> посилається на лічильник `generate_series`, планер обчислює **один раз** на весь `INSERT` — і всі
> 500 000 рядків виходять однаковими (`type` = `expense`, `status` = `posted`, `currency` = `USD`
> на всю таблицю). Прив'язка потоків до номера рядка це і виправляє, і робить дані детермінованими.

## Чому суми `bigint`, а курси `numeric`

**Float у схемі немає ніде** — саме це й захищає «Don't Do This». Далі схема свідомо проводить межу
між сумами й курсами.

**Суми — `bigint` у мінімальних одиницях** (`amount_cents`, `balance_cents`, `quantity_micro`).
Мінімальна одиниця тут задана валютою об'єктивно, її знає ISO 4217 — це колонка `currency.exponent`.
Тип фіксованої довжини й pass-by-value дає вужчий рядок і швидше сортування на 500 000 рядків, а
контракт [`openapi/openapi.yaml`](openapi/openapi.yaml) уже оголошує ці поля як `integer/int64` —
тож БД і дріт говорять одним типом і конверсія на шві репозиторію не потрібна взагалі.

Запас перевірено, а не припущено:

| | копійок | у гривнях |
|---|---|---|
| стеля `bigint` | 9 223 372 036 854 775 807 | **92 233 720 368 547 758 грн** |
| 1 млн грн | 100 000 000 | запас ще ×92 млрд |
| держбюджет України ~4 трлн грн | 400 000 000 000 000 | запас **×23 058** |

**Курси й ціни — `numeric(20,10)`.** У курсу природної мінімальної одиниці не існує: будь-який
множник (`×10⁸`) був би вигаданий і жив би в коментарі, а не в типі. Практичніший аргумент —
крос-курс `amount × rate_from / rate_to`: на чистих цілих він переповнюється
(`SELECT 100000000::bigint * 4456160000::bigint * 1000000000::bigint` → `ERROR: bigint out of
range`), а цілочисельне ділення при цьому мовчки обрізає. З `numeric`-курсом множення саме
підіймається в numeric (`pg_typeof(bigint * numeric)` → `numeric`, `sum(bigint)` → `numeric`), тож
переповнення не виникає.

Ціна рішення названа чесно: це шов між двома моделями рівно там, де відбувається множення, і
правило округлення при конверсії доведеться тримати в одному місці — це вже задача ДЗ #14.

## Курси валют

`fx_rate` тримає курс валюти на дату, `source` входить у первинний ключ:

```sql
PRIMARY KEY (currency, rate_date, source)
```

Це не надмірність. НБУ планується як primary, Frankfurter — як backfill історії; без `source` у
ключі два джерела зіткнулися б на `(currency, rate_date)` і тихо перезаписували одне одного, тобто
зникла б рівно та можливість звіряти їх між собою, заради якої й береться друге джерело.

Цей самий PK і є єдиним потрібним індексом, і порядок колонок — `(currency, rate_date, source)` —
відповідає тому, як курси реально читаються: `findLatest` — `WHERE currency = ? AND rate_date <= ?
ORDER BY rate_date DESC, source` (рівність, потім зворотний скан діапазону), а кеш на старті читає
всю таблицю в порядку `currency, rate_date, source` — звичайний Index Scan без сортування. Окремий
індекс не потрібен, і в `db/indexes.sql` його немає.

`raw_rate` + `raw_units` існують тому, що провайдери котирують не завжди за одну одиницю (JPY — за
10, HUF — за 100). `rate` — нормалізоване «UAH за 1 одиницю» — це `GENERATED ALWAYS AS … STORED`,
тож дві колонки фізично не можуть роз'їхатись.

**UAH у `fx_rate` немає взагалі** (`CHECK (currency <> 'UAH')`): це база котирування, вона живе в
`currency`, а identity-курс обробляється в місці читання. Інакше або тримаєш тисячі рядків зі
значенням «одиниця», або констрейнт обіцяє валюту, якої в таблиці насправді немає.

### Звідки брати справжні дані

| Джерело | Bulk-вивантаження | Формат |
|---|---|---|
| **НБУ** | **є, JSON одним запитом на валюту** | `https://bank.gov.ua/NBU_Exchange/exchange_site?start=19990101&end=20260917&valcode=usd&sort=exchangedate&order=asc&json` — уся історія ≈ 2 MB за ~1 с. (`statdirectory/exchange` віддає лише одну дату, тому для історії не годиться) |
| Frankfurter | є, CSV одним запитом | `https://api.frankfurter.dev/v2/rates.csv?providers=NBU&base=USD&quotes=UAH&from=1999-01-04` |

Дві дрібниці, які видно тільки з живої відповіді Frankfurter і які легко проґавити:

- заголовок CSV — рівно `date,base,quote,rate`; колонки `provider` там **немає**, тож `source`
  проставляє завантажувач константою;
- `base=UAH&quotes=USD` дає **обернений** курс (0.022 USD за 1 UAH). Для рідної орієнтації НБУ
  («гривень за одиницю») потрібно `base=USD&quotes=UAH` → 44.55. Два `base` в одному запиті не
  приймаються (`422 invalid currency: USD,EUR`), тож це окремий запит на валюту.

Далі — `COPY fx_rate_staging FROM … WITH (FORMAT csv, HEADER)` і перелив у `fx_rate`.

**ECB (`eurofxref-hist.zip`) не підходить зовсім:** гривні в списку ЄЦБ немає й ніколи не було,
а база котирування тут — UAH, тож з того файлу не вийде жодного рядка `fx_rate`.

### Синхронізація з НБУ на старті

Обрано прямий ендпоінт НБУ, а не Frankfurter: він віддає `units` (JPY у 1999-му — за 1000, зараз —
за 10), і це лягає 1:1 у `raw_rate`/`raw_units`, а CSV Frankfurter дає лише вже поділений курс.

Послідовність (`FxSyncService.onApplicationBootstrap` — відпрацьовує до `listen()`):

1. `FX_SYNC_ON_START=1` → для кожної не-базової валюти з `currency` беремо `MAX(rate_date)` для
   `source = 'nbu'` і тягнемо з НБУ **лише дні після нього** (останній день — ще раз: саме його НБУ
   найімовірніше виправить) до завтра включно (курс на завтра НБУ публікує вдень). Порожня таблиця →
   від `FX_BACKFILL_FROM` (`1999-01-01`). Upsert: новий день вставляється, виправлений —
   оновлюється, незмінений не чіпається. Валюти синкаються **паралельно** через RxJS
   `mergeMap` (буквально «N паралельних стрімів злиті в один»; `rxjs` і так прямa залежність —
   тягне її NestJS, нового пакета не додано), обмежено `min(cpus().length, DB_POOL_MAX)`: на 8-ядерній
   машині це ~40 валют партіями по 8 замість одна-за-одною, і жодна не забирає в пулу більше з'єднань,
   ніж там є. Одна валюта, що впала (таймаут, НБУ її не котирує), не скасовує решту — та сама
   ізоляція, що й раніше в послідовному циклі.
2. Усі ефективні курси (`DISTINCT ON (currency, rate_date) … ORDER BY source ASC` — той самий
   tie-break, що й у `findLatest`) вантажаться в `FxRateCache`.

Недоступний НБУ або помилка завантаження кешу застосунок не валять: віддається те, що вже є в
таблиці. Лока між інстансами немає свідомо: upsert ідемпотентний (`repo.upsert` з
`skipUpdateIfNoValuesChanged`), тож два одночасні старти коштують лише зайвий запит до НБУ.

`source` — `'nbu'`, а не `'NBU'`: під `'NBU'` `db/seed.sql` пише **синтетичні** курси, і синк,
продовжуючи з їхньої останньої дати, прийняв би вигадані три роки за справжню історію.

**Валютний набір** — `UAH` плюс усі 40 фіатних валют, які котирує НБУ (живий фід
`bank.gov.ua/NBU_Exchange/exchange?json` перевірено під час додавання цього). Один спільний
`Currency` (`src/domain/currency.ts`) — і для рахунків/транзакцій, і для `GET
/fx-rates/:currency/latest`: жодного окремого allow-list per-фіча. Нові валюти в `currency`
з'являються через `npm run seed` (`src/seed.ts` — єдине місце, яке гарантовано виконує грейдер;
`db/seed.sql`/`db/dev-fixtures.sql` — свідомо вужчі, незалежні снепшоти, README вже це пояснює в
розділі «Як додати нову валюту»). Далі синк і кеш підхоплюють їх без жодної зміни коду: обидва
читають з таблиці `currency`, а не зі списку в коді.

НБУ також котирує банківські метали `XAU/XAG/XPT/XPD` (той самий `exchange_site`-ендпоінт,
`group: "3"` замість `"1"`, історія з ~2001 року) та `XDR` (СПЗ МВФ) — підтверджено живим запитом,
технічно так само підключаються, але свідомо не додані в цьому проході: це не фіатна валюта
країни, і чи має сенс дозволяти рахунок/транзакцію в золоті — окреме продуктове рішення, а не
інфраструктурне.

**Знайдена «на живу» аномалія НБУ:** `valcode=gel` в історичному фіді повертає `r030=381` для дат
до ~вересня 2002-го і `r030=981` (справжній ISO 4217 код GEL) після — внутрішній код НБУ до якоїсь
їхньої міграції, а не переплутана валюта. Тому `nbu.client.ts` звіряє відповідь лише по `cc`
(літерному коду), не по `r030` — `numeric_code` у нашій `currency` лишається ISO-правильним, а
звірка з чужим значенням з чужого зафіксованого архіву тільки викидала б справжні рядки.

**Порядок колонок PK під кеш-завантаження.** Спершу PK був `(source, currency, rate_date)`, а
жоден реальний запит на `source` не фільтрує — кеш на старті робив Seq Scan + сортування на диск.
Міграція [`FxRatePrimaryKeyCurrencyFirst`](src/migrations/1789260000000-FxRatePrimaryKeyCurrencyFirst.ts)
переставила колонки на `(currency, rate_date, source)` замість того, щоб додавати другий індекс;
заміри (467 → 188 мс на кеш-завантаженні, 19 → 9.5 MB, відкинуті варіанти) — у її коментарі.

**Знімок історії в git.** Щоб свіже середовище не тягнуло 27 років:

```bash
npm run build && npm start            # перший старт заповнює fx_rate з НБУ
npm run fx:dump                       # → db/fx-rates-nbu.csv
```

Далі в новому середовищі — після міграцій і `npm run seed` (потрібні рядки `currency`)
`npm run db:fx-rates`: CSV → temp-таблиця через `COPY … FROM STDIN` → `INSERT … ON CONFLICT DO
NOTHING` (знімок ніколи не перетирає новішу корекцію), і старт дотягує тільки дні після знімка.
CSV, а не `INSERT`-и: утричі менший і дифається в git по рядку на день
([`scripts/fx-rates-snapshot.sh`](scripts/fx-rates-snapshot.sh)). Сортування — `ORDER BY rate_date,
currency`, дата перед валютою: кожен наступний `fx:dump` лише **дописує** нові (пізніші) дні, тож
при такому сортуванні вони завжди лягають одним суцільним блоком у кінець файлу — один чистий diff
замість 40 розкиданих правок (по одній на кожен валютний блок, якби сортування було
`currency, rate_date`). Колонки: `rate_date, currency, rate, raw_rate, raw_units, source` — `rate`
(сам курс, а не лише сирі `raw_rate`/`raw_units`) тут для читабельності: у `fx_rate` він
`GENERATED`, тож `db:fx-rates` його читає з CSV, але назад не пише.

У `db/seed.sql` курси **синтетичні**: seed мусить відпрацювати офлайн у контейнері грейдера. Але
порядок величин збігається з живим фідом на вересень 2026 (USD ≈ 44.5, EUR ≈ 51.8), значення
округлені до 4 знаків, як у справжній відповіді, і згенеровані лише на робочі дні — саме так, як
публікує НБУ.

### Як додати нову валюту

Через довідник, а не міграцію — заради цього `currency` і зроблено таблицею замість
`CHECK (currency IN (...))`:

```sql
INSERT INTO currency (code, numeric_code, exponent, name) VALUES ('PLN', 985, 2, 'Polish zloty');
```

І все. З `CHECK`-констрейнтом кожна нова валюта означала б міграцію з переписуванням констрейнта —
а на `transactions` це ще й перевірка всіх 500 000 рядків.

## Індекси — рівно три

| Індекс | Тип | Запит | Розмір |
|---|---|---|---|
| `transactions_account_booked_idx` `(account_id, booked_at DESC, id DESC) INCLUDE (type, amount_cents, currency, fx_rate)` | складений + covering (`INCLUDE` додано в ДЗ #13, див. нижче) | q1 | 46 MB |
| `transactions_pending_booked_idx` `(booked_at DESC, id) WHERE status = 'pending'` | **partial** | q2 | 448 kB |
| `accounts_lower_name_idx` `(lower(name))` | **expression** | q3 | 2 256 kB |

Partial-індекс покриває 2.18% таблиці й тому в ~64 рази менший за складений. Expression-індекс
обов'язковий саме тут: у `WHERE` стоїть `lower(name)`, і індекс по самій колонці `name` планер
проігнорував би.

Нічого «про запас» не додано — перевірка `pg_stat_user_indexes` із нульовими `idx_scan` показує
лише індекси, що підпирають PRIMARY KEY і UNIQUE; усі три оптимізаційні використані.

## Результати

| Запит | Що робить | До | Після | Прискорення | Buffers |
|---|---|---:|---:|---:|---|
| q1 | виписка по рахунку за квартал | 47.085 мс | 1.293 мс | ×36 | 9 174 → 53 |
| q2 | черга операцій у статусі `pending` | 45.231 мс | **2.445 мс** | **×18** | 9 158 → 102 |
| q3 | пошук рахунку без урахування регістру | 15.920 мс | **0.087 мс** | **×183** | 864 → 4 |

Мілісекунди залежать від навантаження на машину, тому надійніший показник — buffers: вони падають
у 90–216 разів і від навантаження не залежать узагалі.

q1 отримав другий крок у ДЗ #13 — `INCLUDE` на тому самому індексі прибрав і ці 53 buffers, див.
нижче.

Повні виводи `EXPLAIN (ANALYZE, BUFFERS)` до і після, з поясненням кожного плану —
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md).

## Структура ДЗ #12

| Шлях | Призначення |
|---|---|
| [`db/schema.sql`](db/schema.sql) | 7 таблиць, 8 FOREIGN KEY, CHECK-констрейнти, GRANT для `invest_app` |
| [`db/seed.sql`](db/seed.sql) | генерація даних + `VACUUM (ANALYZE)` |
| [`db/queries/q1.sql`](db/queries/q1.sql) | виписка по рахунку за період (keyset-пагінація) |
| [`db/queries/q2.sql`](db/queries/q2.sql) | фільтр по статусу `pending` |
| [`db/queries/q3.sql`](db/queries/q3.sql) | пошук без урахування регістру |
| [`db/indexes.sql`](db/indexes.sql) | три індекси: складений, partial, expression |
| [`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md) | 3 пари `EXPLAIN` до/після + пояснення |
| [`secrets/db_password.example`](secrets/db_password.example) | стартовий дев-пароль ролі `invest_app` |

`db/seed.sql` закінчується саме `VACUUM (ANALYZE)`, а не `ANALYZE`: статистику для планера дає
`ANALYZE`, але visibility map виставляє тільки `VACUUM` — без неї Index Only Scan усе одно лізе в
heap, і buffers «після» виходять у рази гірші, ніж могли б.

# ДЗ #13 курсового: TypeORM, міграції, N+1

Схема з ДЗ #12 (`db/schema.sql`) переїжджає в код так, як це робиться у проді: entities +
relations + міграції, `synchronize: false`, детермінований ідемпотентний seed, доказ і лікування
N+1, звіт через `QueryBuilder`. `db/*.sql` лишаються артефактом ДЗ #12 — джерелом правди для
схеми тепер є міграція `src/migrations/`.

## Grading

Грейдер не має доступу до сховища секретів (Infisical, ДЗ #11) — на свіжому клоні
`npm run migrate` одразу впаде на `infisical`-виклику. Нижче — рівно той блок команд, який дає
робочу базу без сховища: `SKIP_VAULT=1` перемикає `scripts/with-secrets.sh` на прямий `exec`, а
`DB_*` беруться з дев-креденшелів `docker-compose.yml` (вони не є секретом).

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5433 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=invest
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

Далі — звичайний прогін:

```bash
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run seed
npm run seed        # вдруге — без дублювання рядків
npm run demo:nplus1
npm run report
npm test
```

## Локально (зі сховищем)

Той самий набір команд, без `SKIP_VAULT` і без ручного `export DB_*` — `scripts/with-secrets.sh`
сам підвантажує `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` з Infisical:

```bash
docker compose up -d --wait
npm run build
npm run migrate
npm run seed
```

Перший запуск без `.secrets/infisical.env` завершується підказкою — скопіюй
[`.secrets/infisical.env.example`](.secrets/infisical.env.example) і заповни свій проєкт.

## Entities та relations

Сім entities в [`src/entities/`](src/entities/) — колонка в колонку зі схемою ДЗ #12: типи,
`@Index`, nullable, CHECK-и (`@Check`) з тими самими іменами constraint-ів, що й у
`db/schema.sql`. Гроші — `bigint` у мінорних одиницях (`balance_cents`, `amount_cents`,
`quantity_micro`), без жодного float; курси й ціни — `numeric(20,10)`.

`fx_rate.rate` — згенерована колонка (`generatedType: 'STORED'`), Postgres рахує її сам із
`raw_rate / raw_units`; `insert: false, update: false` тримає TypeORM подалі від запису в неї.

**M:N із даними на зв'язку.** У схемі немає окремої join-таблиці — `transactions` сама і є цим
зв'язком: вона лежить між `accounts` і `instruments` (нульовий `instrument_id`, обов'язковий лише
для `buy`/`sell`) і несе дані на зв'язку (`quantity_micro`, `unit_price`, знімок `fx_rate`). Тому
вона змодельована як звичайна entity з двома `@ManyToOne`, а не `@ManyToMany`.

**`onDelete` — три різні стратегії:**

| Зв'язок | Стратегія | Чому |
|---|---|---|
| `accounts.user_id → users` | `CASCADE` | рахунок без власника не існує — видалення каскадує |
| `transactions.account_id → accounts` | `CASCADE` | історія рахунку помирає разом із рахунком |
| `transactions.instrument_id → instruments` | `RESTRICT` | інструмент з угодами видалити не можна — знищило б історію |
| `transactions.category_id → categories` | `SET NULL` | категорія — лише класифікація, її зникнення не стирає факт |
| `*.currency → currency` | (дефолт, без `onDelete`) | довідник ISO-4217, рядки з нього не видаляють |

`grep -rn "onDelete" src/` — 4 збіги, 3 різні стратегії (`CASCADE`, `RESTRICT`, `SET NULL`).

## Три індекси з ДЗ #12 — вручну в міграції

Декоратор `@Index` не вміє `DESC`, `WHERE` чи вираз (`lower(...)`), тож entity несуть
`@Index('...', { synchronize: false })` лише для документації, а сама DDL дописана руками в
`src/migrations/*-InitSchema.ts`:

```sql
CREATE INDEX transactions_account_booked_idx ON transactions (account_id, booked_at DESC, id DESC);
CREATE INDEX transactions_pending_booked_idx ON transactions (booked_at DESC, id) WHERE status = 'pending';
CREATE INDEX accounts_lower_name_idx ON accounts (lower(name));
```

`down()` реально відкочує: `DROP INDEX` для цих трьох, `DROP CONSTRAINT` для FK-ів,
`DROP TABLE` у зворотному порядку залежностей.

## `synchronize: false`

[`src/data-source.ts`](src/data-source.ts) вимикає його явно (`synchronize: false`), а не
покладається на дефолт — так критерій видно без читання коду TypeORM.

## Seed — детермінований і ідемпотентний

[`src/seed.ts`](src/seed.ts): 41 валюта, 8 users, 10 instruments, 8 categories, 12 accounts,
12 fx_rate, 40 transactions. Жодного `Math.random()`/`Date.now()` — id зібрані з фіксованих
префіксів (`00000001-0000-4000-8000-…`), дати — з фіксованого зсуву від `2026-01-01`.
Ідемпотентність — через `repository.upsert(rows, { conflictPaths: [...] })` по PK/природному
ключу кожної таблиці.

Перевірка (рівно та команда, яку прогнав грейдер):

```sql
SELECT (SELECT count(*) FROM currency) || ',' || (SELECT count(*) FROM users) || ','
    || (SELECT count(*) FROM instruments) || ',' || (SELECT count(*) FROM categories) || ','
    || (SELECT count(*) FROM accounts) || ',' || (SELECT count(*) FROM fx_rate) || ','
    || (SELECT count(*) FROM transactions);
```

До і після другого `npm run seed`: `41,8,10,8,12,12,40` — без змін.

## N+1: доведено і вилікувано

[`src/demo-nplus1.ts`](src/demo-nplus1.ts) вмикає `logging: ['query']` і власний
`QueryCountLogger`, що рахує кожен SQL-запит. Граф — `account → transactions → instrument`
(2 рівні). Виміряно на двох розмірах вибірки, щоб показати, що «після» не росте разом з N:

| Розмір вибірки | наївно (запит у циклі) | `relations` / `leftJoinAndSelect` | `relationLoadStrategy: 'query'` |
|---|---|---|---|
| N=4  | 7 запитів (≥ 4)   | **1 запит** | 5 запитів |
| N=12 | 20 запитів (≥ 12) | **1 запит** | 5 запитів |

`1 + 2 × рівнів` для `relationLoadStrategy: 'query'` на графі з 2 рівнів = `1 + 2×2 = 5` — збігається.
`relations`/`leftJoinAndSelect` дає рівно 1 запит лише коли вибірка фільтрується через
`WHERE id IN (...)`, а не `take`/`skip`: пагінація разом із JOIN по one-to-many змушує TypeORM
робити два запити (спершу id-и з `LIMIT`, потім повні дані) — це задокументовано прямо в скрипті.

### Той самий симптом на шляху запису

`demo-nplus1.ts` міряє читання, але N+1 був і в `POST /transactions`: цикл по entries робив
`findById` на кожну entry, а всередині `save()` — ще лукап інструмента по symbol і лукап
fx-курсу, теж на кожну. Для батчу з N entries це до 3N+M round-trip'ів, при тому що батч
здебільшого повторює ті самі кілька `account_id` і той самий symbol.

Тепер акаунти резолвляться один раз на весь батч (`AccountsRepository.findByIds` → `WHERE id IN`),
інструменти — один раз по унікальних symbol (`WHERE symbol IN`), курси — один раз на унікальну пару
`(currency, дата)` (`FxRatesService.getEffectiveRates`), а вставка йде одним multi-row `INSERT`
(`TransactionsRepository.saveMany`). Заміряно на батчі з 5 entries (2 рахунки, 2 валюти, 3 з тим
самим `VOO`), лог `DB_LOG=1`:

| Крок | Було | Стало |
|---|---:|---:|
| `SELECT` рахунків | 5 | **1** (`id IN (…)`) |
| `SELECT` інструментів | 3 | **1** (`symbol IN (…)`) |
| Лукапи fx-курсу | 3 | 3 (унікальні пари `USD`+дата) |
| `INSERT` транзакцій | 5 | **1** (multi-row `VALUES`) |
| `UPDATE` балансів | 2 | 2 (дедуплікація по рахунку була й до того) |
| **Разом у транзакції** | **18** | **8** |

Чесна засторога про курси: дедуплікація тут по **парі** `(currency, дата)`, а не просто по валюті —
різні дати це різні курси, тому батч із 100 entries на 100 різних днів усе ще дасть 100 лукапів.
Для реальних батчів (виписка за один день, дві ноги переказу) це 1-2 запити. Звести й цей випадок
до одного запиту можна `JOIN LATERAL` по списку `VALUES` — свідомо не робив, бо складність там
більша за виграш на типових даних.

Бонус від multi-row `INSERT`: часткового батчу не існує вже на рівні одного SQL-стейтменту —
порушення CHECK на будь-якому рядку валить весь `INSERT`, а не лише цей рядок.

## Кешування: де можна, а де ні

Два різні механізми, які легко сплутати.

**Map у `FxRatesService.getEffectiveRates()` — це не кеш, а дедуплікація в межах однієї
операції.** Він живе рівно один виклик `create()`, всередині однієї DB-транзакції, і вмирає разом
із нею — тому в нього немає ні інвалідації, ні staleness, ні росту пам'яті, ні розбіжності між
інстансами. І головне, користь із нього не лише перформансна: під `READ COMMITTED` два окремі
`SELECT` в одній транзакції можуть побачити різні дані, якщо між ними хтось закомітив новий рядок
у `fx_rate`, а Map гарантує, що всі рядки одного батчу отримають **однаковий** знімок курсу.

**In-memory індекс курсів (`FxRateCache`) — з ДЗ про синк з НБУ.** Раніше тут стояло «свідомо ні»
через три ризики; ось як кожен закритий:

- *протухлий курс нового дня вмерзає в транзакцію* — кеш відповідає лише на дати **не пізніше
  останньої завантаженої** для валюти; усе після неї (курс, дописаний після старту, зокрема іншим
  інстансом) іде в БД, у тій самій транзакції, що й раніше;
- *інвалідація* — минулі дні це write-once історія; єдине, що кеш не побачить до рестарту, —
  корекція НБУ вже завантаженого дня;
- *розбіжність між інстансами* — усі беруть дані з однієї таблиці на старті, а нові дні однаково
  читаються з БД.

Пошук — бінарний по відсортованих датах валюти, `O(log n)` на ~10k записів; уся історія — кілька MB.

**HTTP-кеш на `GET /fx-rates/{currency}/latest` — навпаки, доречний**, і безпечний саме тому, що
**шлях запису не ходить через контролер**: `saveMany()` читає курс напряму з БД, тож кешована
відповідь фізично не може потрапити у збережений знімок.

`ETag` і `304 Not Modified` Express віддавав і раніше — бракувало свіжості, тобто кожен запит усе
одно йшов по мережі. Тепер:

| Запит | `Cache-Control` | Чому |
|---|---|---|
| `on` у минулому (закритий день) | `public, max-age=86400` | змінюється лише через корекцію джерела |
| `on` не заданий / сьогодні | `public, max-age=60` | курс дня ще можуть опублікувати, а URL без `on` завтра той самий |
| `404` — курсу ще немає | `no-store` | backfill може зробити з нього `200`, а RFC 9111 дозволяє кешам зберігати 404 евристично |
| `GET /accounts`, `GET /transactions` | `no-store` | мутабельні списки; без заголовка проксі вільний увімкнути евристичну свіжість |

`@nestjs/cache-manager` так і не знадобився: зовнішній фетч робиться лише на старті й одразу
пишеться в `fx_rate`, а читання обслуговує `FxRateCache` (див. вище).

## Repository vs QueryBuilder

[`src/report.ts`](src/report.ts) — оборот по категоріях (`SUM(amount_cents * fx_rate)`,
`COUNT`, `GROUP BY`, `JOIN` на `categories`) через `createQueryBuilder().getRawMany()`.
`find()`/`findOne()` — поки результат є графом entities й фільтром по колонках (спискові й
детальні ендпоінти). `QueryBuilder` — щойно результат перестає бути entity: агрегати,
`GROUP BY`, віконні функції, ручні підзапити чи часткові проєкції, які `find()` виразити не може.

## TypeORM у застосунку

[`AccountsRepository`](src/accounts/accounts.repository.ts)/
[`TransactionsRepository`](src/transactions/transactions.repository.ts) — конкретні,
асинхронні класи, що напряму інжектують `Repository<T>` з TypeORM (`@InjectRepository`) і
мапають entity на доменні типи ДЗ #9. Раніше це були in-memory реалізації за окремим
абстрактним класом плюс паралельна `TypeOrm*Repository` під прапорцем `DB_BACKEND` — тепер
абстракції немає: клас, що інжектується в сервіс, і є TypeORM-реалізацією, `AccountsModule`/
`TransactionsModule` просто реєструють його як звичайний провайдер. Домен ДЗ #9 не має понять
`user_id` чи знімка `fx_rate`, тож обидва репозиторії підставляють задокументовані заглушки
(фіксований system-user, плейсхолдер-курс) — позначено коментарями в коді.

Наслідок: `npm start` і `npm run start:dev` тепер потребують живого, промігрованого Postgres
(`docker compose up -d --wait` → `npm run build` → `npm run migrate`). `npm test` (юніт-специ)
цього не потребує — вони мокають клас `AccountsRepository`/`TransactionsRepository` як
DI-токен напряму (Nest дозволяє клас-токен без окремого інтерфейсу), жодного модуля Nest не
піднімаючи.

### Опційні фікстури для локального запуску без повного seed

[`db/dev-fixtures.sql`](db/dev-fixtures.sql) — три рахунки й дві транзакції, з тими самими id,
що їх раніше на кожному старті сама вигадувала in-memory реалізація. Файл ідемпотентний
(`ON CONFLICT DO NOTHING`) і призначений для запуску одразу після міграції, коли повний
`npm run seed` не потрібен (наприклад, перед `npm run test:e2e` чи ручним `curl` по свіжій базі):

```bash
docker compose up -d --wait
npm run build && npm run migrate
npm run db:fixtures
```

Ані грейдер, ані `npm test` цей файл не використовують — `npm run seed` (крок нижче) дає ширший і
самодостатній набір даних. Разом із `npm run migrate` він робить `npm run test:e2e` (не входить у
грейдинг, але корисно локально) прогонюваним проти реальної бази без повного seed.

> `@nestjs/typeorm@^11` (не `^12`, який опублікований як чистий ESM `"type": "module"` і не
> парситься `ts-jest`-transform-ом у CJS-режимі Jest) — саме тому в `package.json` версія
> зафіксована на останньому CJS-релізі.

## Атомарність батчу, keyset у SQL і валютний інваріант

Три речі, які аудит звʼязку `accounts` ↔ `transactions` показав як зламані, і які виправлені тут.
Сам DDL звʼязку був правильний (FK `account_id NOT NULL` → `accounts(id)` `ON DELETE CASCADE`,
`transactions` як явна join-entity) — ламався шар поведінки над ним.

**1. `POST /transactions` тепер справді атомарний.** Раніше
[`TransactionsService.create()`](src/transactions/transactions.service.ts) робив N окремих
`await save()`, а потім M окремих `updateBalance()` — кожен своїм автокомітом. Спека при цьому
обіцяла «either every `entries` row is created, or none», і обіцянка була неправдива: падіння на
другій entry (валюта без курсу → 422, або невідомий `instrument_symbol` → CHECK
`transactions_instrument_matches_type`) лишало першу в базі. Тепер усе тіло `create()` —
валідація, вставки, оновлення балансів — виконується всередині одного
`dataSource.transaction(...)`, а `EntityManager` пробрасується опційним параметром у
`TransactionsRepository.save()`, `AccountsRepository.findById()/updateBalance()` і
`FxRatesService.getEffectiveRate()`, щоб усе читалось і писалось в одному снапшоті.

Доказ — e2e-кейс «rolls the whole batch back when a later entry fails»
([test/app.e2e-spec.ts](test/app.e2e-spec.ts)): батч із двох entries, друга — `buy` з неіснуючим
тикером; після 4xx баланс рахунку не змінився, а першої entry в базі немає.

Наслідок для Idempotency-Key: [idempotency.middleware.ts](src/shared/idempotency.middleware.ts)
кешує для відтворення **лише 201**, а на будь-яку помилку — і 4xx, і 5xx — звільняє ключ, бо саме
заради повтору ключ і видається.

> Проміжна версія кешувала ще й 5xx (мовляв, запис міг закомітитись, а впасти вже валідація
> відповіді). Code review показав, що це гірша угода: рідкісний подвійний запис міняли на
> гарантовану поломку — транзієнтний 500 із повним rollback робив ключ непридатним на всі 24 години
> TTL, тож операцію взагалі не можна було довести до кінця, а відтворювана відповідь ішла з
> **порожнім тілом**, бо помилки віддаються через `sendProblem()`/`res.send()` і не проходять через
> патч `res.json`, яким middleware захоплює тіло. Вікно, якого боялася та версія, тепер мізерне:
> уся робота хендлера — одна DB-транзакція, а після `COMMIT` лишається тільки серіалізація
> відповіді.

**1b. Помилки вводу більше не прикидаються 500.** Невідомий `instrument_symbol` (друкарська
помилка або нижній регістр — пошук чутливий до регістру, а CHECK колонки вимагає верхнього) раніше
тихо ставав `instrument_id = NULL`, після чого спрацьовував CHECK
`transactions_instrument_matches_type`, і клієнт отримував `500` з іменем констрейнта й SQLSTATE
`23514` у полі `code`. Тепер обидва правила перевіряються до запису: симетрія типу й символу — у
`TransactionsService.create()` (`instrument-type-mismatch`), існування символу — у
`TransactionsRepository.saveMany()`, де вони й так уже вичитані одним запитом
(`instrument-not-found`). Обидва — `422` з поясненням, який саме запис винен.

**2. Пагінація і фільтр переїхали в SQL.** Було: `findAll()` без `WHERE`/`ORDER BY`/`LIMIT`, далі
сортування й нарізка сторінки в JavaScript — тобто на 500k рядках із ДЗ #12 кожен запит списку
читав усю таблицю, а індекси ДЗ #12 були недосяжні з коду застосунку в принципі. Стало:
`TransactionsRepository.findPage()` / `AccountsRepository.findPage()` із keyset-умовою
`(booked_at, id) < (:c, :id)` — рівно та форма, під яку зроблено
`transactions_account_booked_idx (account_id, booked_at DESC, id DESC)`.

Заміряно на 500k рядків (`db/seed.sql`), той самий запит сторінки:

| | План | Buffers |
|---|---|---:|
| як було (читання всієї таблиці) | `Seq Scan on transactions` + hash join | 9 090 |
| як стало (keyset-сторінка, `LIMIT 20`) | **`Index Scan using transactions_account_booked_idx`** | **23** |

Курсор із row-value порівнянням заходить прямо в `Index Cond`, тож друга й наступні сторінки
коштують стільки ж, скільки перша. `paginate()` із `src/shared/pagination.ts` видалено — лишились
тільки `encodeCursor`/`decodeCursor`, бо непрозорість курсора й далі справа сервера.

> ⚠️ Перенесення порівняння в SQL принесло з собою баг, який знайшов code review: курсор кодується
> з доменного значення, а воно приходить із JS `Date` — тобто з точністю до **мілісекунд**, тоді як
> колонка зберігала **мікросекунди**. Рядок `…:36.035363+00` проти курсора `…:36.035Z` читався як
> «новіший за власний курсор», і всі рядки в тій самій мілісекунді просто зникали з пагінації:
> `GET /accounts?limit=2` віддавав сторінку 1 і сторінку 2, жодного разу не повернувши третій
> рахунок. Стара JS-версія `paginate()` порівнювала обрізане з обрізаним і тому була самоузгоджена.
> Полагоджено міграцією
> [`TimestampMillisecondPrecision`](src/migrations/1789250000000-TimestampMillisecondPrecision.ts):
> усі `timestamptz` — тепер `timestamptz(3)`, тобто рівно та точність, яку система здатна
> представити з кінця в кінець (контракт в `openapi.yaml` і так обіцяв `format: date-time` із
> трьома знаками). Альтернативи — `date_trunc()` у предикаті (індекс перестає працювати) або
> дворівневе порівняння по мілісекундному бакету — програють у простоті.

**3. Валютний інваріант тепер у БД, а не лише в сервісі.** Перевірка «валюта транзакції = валюта
рахунку» жила тільки в `TransactionsService`, тож будь-який інший писач (seed, `psql`, майбутній
ендпоінт) міг покласти USD-транзакцію на UAH-рахунок — а арифметика балансу додає центи до копійок
без конверсії. Міграція
[`AccountCurrencyGuard`](src/migrations/1789230000000-AccountCurrencyGuard.ts) додає складений FK:

```sql
ALTER TABLE accounts ADD CONSTRAINT accounts_id_currency_uk UNIQUE (id, currency);
ALTER TABLE transactions ADD CONSTRAINT transactions_currency_matches_account
  FOREIGN KEY (account_id, currency) REFERENCES accounts (id, currency)
  ON DELETE CASCADE ON UPDATE RESTRICT;
```

Перевірка — прямий `INSERT` повз застосунок:

```bash
docker compose exec -T postgres psql -U postgres -d invest -c "
INSERT INTO transactions (account_id, currency, type, status, amount_cents, fx_rate, booked_at)
VALUES ('11111111-1111-4111-8111-111111111111', 'USD', 'expense', 'posted', 100, 41.5, now());"
# ERROR: violates foreign key constraint "transactions_currency_matches_account"
```

`ON UPDATE RESTRICT` — це друга половина правила: валюта рахунку незмінна, поки в нього є
транзакції. Обидва сіди (`db/seed.sql` з 500k рядків і `src/seed.ts`) сумісні з констрейнтом без
правок — вони й раніше брали валюту транзакції з рахунку; перевірено прогоном `db/seed.sql` на щойно
промігрованій базі.

Той самий інваріант доданий і в сам [`db/schema.sql`](db/schema.sql) (`UNIQUE (id, currency)` на
`accounts`, `transactions_currency_matches_account` на `transactions`) — до цього артефакт ДЗ #12
і жива міграція розходились: у міграції правило вже було, у сирому SQL його не існувало.

> ⚠️ Для майбутніх `migration:generate`: складений FK декораторами не виражається, тож генератор
> може запропонувати `DROP CONSTRAINT "transactions_currency_matches_account"` — цей рядок зі
> згенерованої міграції треба видалити. UNIQUE безпечний: він оголошений на entity через
> `@Unique('accounts_id_currency_uk', ['id', 'currency'])`.

## Ще далі — INCLUDE замість Index Scan

`db/indexes.sql:15` — `transactions_account_booked_idx` покривав ключем лише 3 з 7 колонок, які
бере `q1.sql` (`type`, `amount_cents`, `currency`, `fx_rate` лишались поза індексом), тож навіть
після ДЗ #12 кожен рядок сторінки коштував один heap-візит — `Index Scan`, не `Index Only Scan`.

Міграція [`TransactionsAccountBookedIndexCovering`](src/migrations/1789240000000-TransactionsAccountBookedIndexCovering.ts)
перестворює той самий індекс з `INCLUDE (type, amount_cents, currency, fx_rate)`
(Postgres не має `ALTER INDEX ... ADD INCLUDE`, тому `up()`/`down()` — це `DROP INDEX` + `CREATE
INDEX`); той самий рядок доданий і в [`db/indexes.sql`](db/indexes.sql).

Заміряно на тих самих 500k рядків (`db/seed.sql`), той самий `q1.sql`:

| | План | Buffers | Час |
|---|---|---:|---:|
| до ДЗ #12 (без індексу) | `Seq Scan` | 9 174 | 47.085 мс |
| після ДЗ #12 (індекс без `INCLUDE`) | `Index Scan` | 53 | 1.293 мс |
| після ДЗ #13 (`INCLUDE`) | **`Index Only Scan`, Heap Fetches: 0** | **5** | **0.217 мс** |

Індекс важчає з 28 MB до 46 MB — payload чотирьох колонок дублюється в кожному листковому записі;
свідома плата, бо `q1` — найгарячіший із трьох запитів. Повний план — у
[`db/OPTIMIZATIONS.md`](db/OPTIMIZATIONS.md#ще-далі--include-замість-index-scan).

**Свідомо не чіпали** (теми ДЗ #14/#15): `balance_cents` лишається денормалізованим значенням без
звірки з сумою транзакцій (`opening_balance_cents` пишеться без відповідної транзакції, тож
інваріанта, який можна було б перевірити, просто не існує); ноги переказу не звʼязані між собою
(`transfer_id` немає); власник рахунку — константа `SEED_OWNER_USER_ID`, і жоден шлях читання не
фільтрує за користувачем.

## Структура ДЗ #13

| Шлях | Призначення |
|---|---|
| [`src/entities/`](src/entities/) | 7 entities зі схеми ДЗ #12, relations, `@Check`, `@Index` |
| [`src/migrations/`](src/migrations/) | початкова міграція + `AccountCurrencyGuard` (складений FK) + `TransactionsAccountBookedIndexCovering` (`INCLUDE`) + `TimestampMillisecondPrecision` |
| [`src/data-source.ts`](src/data-source.ts) | `DataSource` з `synchronize: false`, підключення з `process.env` |
| [`src/seed.ts`](src/seed.ts) | детермінований ідемпотентний seed |
| [`src/demo-nplus1.ts`](src/demo-nplus1.ts) | N+1 «до/після» з лічильником SQL-запитів |
| [`src/report.ts`](src/report.ts) | звіт через `createQueryBuilder().getRawMany()` |
| [`src/accounts/accounts.repository.ts`](src/accounts/accounts.repository.ts), [`src/transactions/transactions.repository.ts`](src/transactions/transactions.repository.ts) | `AccountsRepository`/`TransactionsRepository` з ДЗ #9 — тепер конкретні TypeORM-класи, без абстрактного шару |
| [`db/dev-fixtures.sql`](db/dev-fixtures.sql) | опційні фікстури: той самий набір, що раніше давала in-memory реалізація |
| [`scripts/with-secrets.sh`](scripts/with-secrets.sh) | обгортка сховища (ДЗ #11) з `SKIP_VAULT=1` для грейдера |
| [`.secrets/infisical.env.example`](.secrets/infisical.env.example) | шаблон логіна в сховище |

# ДЗ #14 курсового: конкурентність, транзакції, черга задач

ДЗ #13 дало entities і міграції; тут перевіряється, що схема витримує одночасний доступ. Три демо
запускаються однією командою кожне, самі перевіряють свої інваріанти і завершуються кодом ≠ 0, якщо
інваріант порушено: [`demo:race`](src/demo-race.ts) — 50 паралельних checkout-ів без oversell,
[`demo:workers`](src/demo-workers.ts) — пул воркерів на `FOR UPDATE SKIP LOCKED`,
[`demo:retry`](src/demo-retry.ts) — навмисний serialization failure і повтор транзакції.

## Що тут грає роль «товару зі stock»

Умова ДЗ написана під marketplace: декремент `stock` **і** списання балансу покупця. У цьому домені
складу немає — єдиний дефіцитний ресурс це гроші, тож «stock» тут це залишок коштів рахунку,
виражений в одиницях інструмента, а «oversell» це овердрафт. Через це декремент stock і списання
балансу згортаються в **один** захищений `UPDATE`: дефіцитний ресурс один, і другий лічильник
довелося б вигадати (табличка `offerings` з `available_units` існувала б рівно для того, щоб її
декрементувати в демо). Числа від цього не змінюються — вони збігаються з marketplace-версією
один в один:

| Критерій ДЗ | Що друкує `demo:race` |
|---|---|
| товар зі `stock = 10` | рахунок із балансом `10 × 12000` копійок, по одній одиниці за виклик |
| спроб ≥ 50 | `attempts (спроб): 50` |
| успішних рівно 10 | `succeeded (успішних): 10` |
| фінальний `stock` 0 | `final stock (фінальний stock): 0 units (balance 0 cents)` |
| рядків із відʼємним `stock` 0 | `rows with negative stock: 0` — `count(*) FROM accounts WHERE balance_cents < 0` |

Решта вимог лишається буквальною: одна транзакція на операцію, замовлення в `transactions`
(`type = 'buy'`), задача на post-processing у новій `job_queue`, і «недостатньо коштів → відкат
цілої транзакції, замовлень-сиріт немає».

## Grading

Грейдер не має доступу до сховища секретів (Infisical, ДЗ #11) — на свіжому клоні `npm run demo:race`
одразу впаде на `infisical`-виклику. Нижче — рівно той блок, який дає робочу базу без сховища:
`SKIP_VAULT=1` перемикає `scripts/with-secrets.sh` на прямий `exec`, а `DB_*` беруться з
дев-креденшелів `docker-compose.yml` (вони не є секретом). **Порт 5433**, не 5432 — так у
`docker-compose.yml`. `package.json` лежить у корені репо, тож `cd` не потрібен.

```bash
docker compose up -d --wait
export DB_HOST=127.0.0.1 DB_PORT=5433 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=invest
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

`--wait` обовʼязковий: без нього на свіжому томі скрипт стартує раніше, ніж Postgres починає
приймати зʼєднання, і падає з `Error: Connection terminated unexpectedly`.

```bash
npm ci
npx tsc --noEmit
npm run build
npm run migrate
npm run seed
npm run demo:race
npm run demo:workers
npm run demo:retry
```

`npm run build` окремим рядком — як і для `migrate`/`seed` з ДЗ #13: усі скрипти запускають
скомпільований `dist/`, а не `ts-node`. Усі три демо можна запускати повторно в будь-якому порядку:
кожне на старті скидає рівно те, що саме мутує. `demo:race` лишає по собі рахунок
`00000002-…-000000000002` із нульовим балансом — `npm run seed` повертає seed-значення.

## Конкурентність

Числа з прогону на свіжій базі (Postgres 16-alpine, docker, M-series, дефолтний пул на 10 зʼєднань).

### Гонка: 50 паралельних checkout-ів

`npm run demo:race` — `Promise.all` із 50 викликів [`checkout()`](src/concurrency/checkout.ts) на один
рахунок, по одній одиниці за $120 при балансі рівно на 10 одиниць. Жодних черг у застосунку: 50
транзакцій ідуть одночасно і діляться десятьма зʼєднаннями пулу (це пул чемно ставить їх у чергу, а
не застосунок серіалізує роботу).

| | Результат |
|---|---|
| спроб | 50 |
| успішних | **10** |
| відхилено (`insufficient_funds`) | 40 |
| фінальний «stock» | **0** одиниць (баланс 0) |
| рядків із відʼємним балансом | **0** |
| замовлень у `transactions` | 10 |
| задач у `job_queue` | 10 |
| списано | 120 000 = 10 × 12 000 |
| час | 93–130 мс |

Контрольний прогін «а що якби захисту не було»: якщо зі `UPDATE` прибрати `AND balance_cents >= $2`
(тобто перевіряти залишок у JS перед записом), той самий скрипт дає **50 успішних, баланс −480 000,
1 рядок із відʼємним балансом** і завершується кодом 1. Тобто інваріант тримає саме умова в
`UPDATE`, а не збіг обставин.

### Пул воркерів: SKIP LOCKED

`npm run demo:workers` — 24 задачі, 4 воркери (Promise-и в одному процесі, кожен на своєму зʼєднанні),
60 мс на задачу.

| | Результат |
|---|---|
| розподіл | worker-1: 6, worker-2: 6, worker-3: 6, worker-4: 6 |
| оброблено двічі | **0** (`count(*) FROM job_queue WHERE processed > 1`) |
| не завершено рівно один раз | 0 |
| час | 552–617 мс |
| послідовний baseline | 1440 мс (24 × 60) |
| speedup | 2.3–2.6× |

Speedup нижчий за 4×, і це очікувано: `handlerMs` — це `setTimeout`, а не робота, тож на 24 задачі
припадає 96 транзакцій-раундтріпів (claim + update + commit на кожну), і саме вони, а не «обробка»,
з’їдають різницю. Важливе інше: воркерів більше одного, кожна задача пішла рівно до одного, і час
явно менший за послідовний.

Розподіл читається не з памʼяті процесу, а з таблиці: `worker_id` комітиться разом зі `status = 'done'`
і `processed = processed + 1`, однією транзакцією з обробкою. Тому «оброблено двічі: 0» — це твердження
про БД, а не про лічильники в JS.

### Retry: 40001 і повтор транзакції

`npm run demo:retry` — 5 конкурентних read-modify-write під `REPEATABLE READ` на один рядок
(`accounts.balance_cents`): прочитати, додати 100 у JS, записати абсолютним значенням. Барʼєр робить
сценарій детермінованим: на першій спробі всі 5 читають до того, як хтось запише, тож 4 провали
гарантовані, а не випадкові.

| | Результат |
|---|---|
| пійманих помилок | 4–5, усі `40001` |
| спроб на писаря | writer-1: 1, writer-2..4: 2, writer-5: 2–3 |
| стартовий баланс | 1 000 000 |
| фінальний баланс | **1 000 500** = 1 000 000 + 5 × 100 |

П’ятий повтор у частині прогонів — це писар, який на своєму retry знову наскочив на свіжий коміт
сусіда. Обгортка просто повторює ще раз; арифметика сходиться в обох випадках.

### Чому atomic `UPDATE … RETURNING`, а не `SELECT … FOR UPDATE`

У checkout захист від перевитрати — це
`UPDATE accounts SET balance_cents = balance_cents - $2 WHERE id = $1 AND balance_cents >= $2 RETURNING …`.
Один оператор робить три речі одночасно: бере ексклюзивний лок на рядок, перевіряє умову вже під
локом і застосовує зміну; 0 у `rowCount` **означає** «не вистачило коштів». Альтернатива
(`SELECT … FOR UPDATE`, порівняння в JS, потім `UPDATE`) дає той самий результат, але це два раунд-тріпи
замість одного і перенесення умови в застосунок — тобто зайве місце, де може зʼявитися порівняння зі
застарілим значенням (наприклад, якщо хтось пізніше «оптимізує» `SELECT` без `FOR UPDATE`). Тут
нічого не потрібно робити з прочитаним значенням, крім порівняння, тож тримати рядок залоченим між
двома запитами — плата без вигоди.

`FOR UPDATE` натомість використано там, де він справді потрібен — у воркері
([`src/concurrency/worker.ts`](src/concurrency/worker.ts)): задачу треба **утримати** залоченою на
весь час обробки, а не змінити одним оператором. Плюс `SKIP LOCKED`, щоб сусідній воркер не стояв за
локом, а брав наступну вільну задачу. Через TypeORM це `setLock('pessimistic_write')` +
`setOnLocked('skip_locked')`; у логі (`DB_LOG=1`) видно згенероване
`… ORDER BY "j"."created_at" ASC, "j"."id" ASC LIMIT 1 FOR UPDATE SKIP LOCKED`.

Транзакція у воркері лишається відкритою на весь handler: якщо воркер упаде до `COMMIT`, лок зникне
разом зі зʼєднанням і задачу підбере інший. Порожній результат `SKIP LOCKED` не означає «черга
порожня» — усі pending-рядки можуть бути зайняті сусідами саме в цю мить, тому воркер перепитує
`maxIdlePolls` разів перед виходом.

### Чому retry ловить лише `40001` і `40P01`

[`src/concurrency/retry.ts`](src/concurrency/retry.ts) повторює транзакцію рівно на двох SQLSTATE:

* `40001` `serialization_failure` — Postgres не зміг витримати рівень ізоляції;
* `40P01` `deadlock_detected` — Postgres розірвав цикл локів, убивши нашу транзакцію.

Спільне в них те, що й робить повтор безпечним: транзакцію відкотило **цілком**, вона не залишила
по собі жодного ефекту, а на новому знімку ті самі оператори мають шанс пройти. Більше жоден код
цієї властивості не має. `23505` (unique violation), `23514` (check violation), `23503` (FK
violation) детерміновані — повтор просто провалиться знову, лише повільніше, і замаскує справжній
баг замість того, щоб його показати. `57014` (statement cancelled) — це хтось свідомо нас зупинив.
`08006` (connection failure) гірший за всі: якщо звʼязок обірвався під час `COMMIT`, невідомо, чи
транзакція закомітилась, і сліпий повтор може застосувати її двічі.

Повтор — це повтор **усієї** транзакції, разом із читаннями. Саме читання зробив недійсним
відкочений знімок: повторити лише `UPDATE` означало б записати значення, порахуване зі застарілого
читання, тобто рівно той lost update, від якого нас щойно врятував `REPEATABLE READ`. Backoff —
експоненційний із повним джитером, щоб пачка писарів, яка зіткнулась один раз, не вишикувалась
і не зіткнулась знову за тим самим розкладом.

## Структура ДЗ #14

| Шлях | Призначення |
|---|---|
| [`src/concurrency/checkout.ts`](src/concurrency/checkout.ts) | одна транзакція: захищене списання → курс → замовлення → задача в чергу |
| [`src/concurrency/worker.ts`](src/concurrency/worker.ts) | воркер: `setLock('pessimistic_write')` + `setOnLocked('skip_locked')`, транзакція відкрита на час обробки |
| [`src/concurrency/retry.ts`](src/concurrency/retry.ts) | `withRetry` + `RETRYABLE_SQLSTATES` (`40001`, `40P01`), backoff із джитером |
| [`src/demo-race.ts`](src/demo-race.ts) | 50 паралельних checkout-ів, перевірка інваріантів, exit ≠ 0 на oversell |
| [`src/demo-workers.ts`](src/demo-workers.ts) | пул воркерів, розподіл, «оброблено двічі», час vs послідовний baseline |
| [`src/demo-retry.ts`](src/demo-retry.ts) | барʼєр → `40001` → повтор, перевірка арифметики |
| [`src/migrations/1789922194647-JobQueue.ts`](src/migrations/1789922194647-JobQueue.ts) | `job_queue` + частковий індекс для claim-запиту |
| [`src/entities/job.entity.ts`](src/entities/job.entity.ts) | entity черги (`processed`, `worker_id`, `@Check`, частковий `@Index`) |

# ДЗ #15 курсового: PgBouncer, бекапи, restore-drill

База курсового вже має схему (#12), міграції (#13) і транзакції (#14). Це ДЗ додає їй два атрибути
production-системи: пулер зʼєднань перед Postgres і бекап, у відновленні якого є впевненість, бо він
відновлений і зміряний — [`RESTORE-DRILL.md`](RESTORE-DRILL.md).

Нового секрета тут не зʼявилось. Змінилось лише значення рядка підключення у сховищі з ДЗ #11: хост і
порт тепер вказують на PgBouncer. У [`.env.example`](.env.example) оновлено рівно цей рядок-контракт
(`DB_URL=postgres://invest_app@localhost:6432/invest`), і `npm run check:env` лишається зеленим —
перевіряються імена ключів, а не значення.

## Data layer ops

```bash
docker compose up -d --wait                  # postgres + pgbouncer, обидва з healthcheck
npm run db:backup                            # → backups/invest-2026-09-20_203003.dump
npm run db:restore-drill                     # → MATCH або ненульовий код
```

Обидва скрипти запускаються з кореня репо і беруть підключення з оточення, тією самою обгорткою, що
й усе інше з ДЗ #11:

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

[`scripts/lib/db-url.sh`](scripts/lib/db-url.sh) приймає три форми, у тому самому порядку, що й
[`src/data-source.ts`](src/data-source.ts): `DATABASE_URL` → `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`
(це інжектить Infisical) → `DB_URL` + пароль із файла. Без жодної з них скрипт падає з
`DATABASE_URL: unbound variable` і підказкою — нового env-файла ДЗ #15 не заводить.

Дамп і drill **не ходять через пулер і не використовують хостові клієнти**. `pg_dump` і `psql`
запускаються всередині контейнера `postgres`, бо клієнт не має бути старішим за сервер: хостовий
`pg_dump 13` проти сервера 16 просто відмовляється працювати. З тієї ж причини `pg_restore --list`
на хості з клієнтом < 16 скаже `unsupported version (1.15) in file header` — еквівалент, який працює
завжди:

```bash
docker compose exec -T postgres pg_restore --list < backups/<файл>.dump
```

Розклад — у [`backup.cron`](backup.cron): `17 3 * * *`, один дамп на добу, з чого прямо випливає
RPO ≤ 24 год. `backups/` ігнорується git-ом (артефакти, не код), сама тека лишається в репо.

## Чому transaction mode і що він ламає

`pool_mode = transaction` у [`pgbouncer/pgbouncer.ini`](pgbouncer/pgbouncer.ini) означає, що серверне
зʼєднання закріплюється за клієнтом на час **однієї транзакції**, а не на час сесії. Це єдиний режим,
у якому пулер справді щось дає: у session mode кожен клієнт усе одно тримає свій бекенд, і пулер
вироджується в проксі. Ефект видно числами — `npm run demo:race` відкриває 50 паралельних checkout-ів
через `DB_POOL_MAX=10`, а на боці Postgres під час цього живе рівно `default_pool_size = 5` бекендів:

```
$ psql -h 127.0.0.1 -p 6432 -U postgres -d pgbouncer -c "SHOW POOLS"
 database | user     | cl_active | sv_idle | ... |  pool_mode
----------+----------+-----------+---------+-----+-------------
 invest   | postgres |         0 |       5 | ... | transaction
```

Платить за це клієнт очікуванням: `SHOW STATS` після тієї ж пачки показує `total_wait_time = 581 923`
мкс на 81 транзакцію. Це і є суть пулера — черга замість відмови.

Що transaction mode ламає:

1. **Іменовані prepared statements.** `PREPARE` живе в сесії, а наступна транзакція того самого
   клієнта може піти на інший бекенд, де цього імені немає — класичне
   `prepared statement "S_1" does not exist`. Цьому коду не болить: драйвер `pg` шле unnamed-запити
   розширеного протоколу, іменованих `PREPARE` у `src/` немає. Страховка на випадок драйвера, який
   так не вміє, все одно стоїть: `max_prepared_statements = 200` (PgBouncer ≥ 1.21 відстежує їх сам).
2. **Будь-який сесійний стан.** `SET`/GUC поза транзакцією, `search_path`, сесійні `TEMP TABLE`,
   `LISTEN/NOTIFY`, сесійні advisory-локи — усе це після `COMMIT` може опинитись «не на тому»
   бекенді. Тому [`scripts/fx-rates-snapshot.sh`](scripts/fx-rates-snapshot.sh), який робить
   `CREATE TEMP TABLE` і `COPY` в одній сесії, ходить через `docker compose exec`, а не через 6432.
3. **`pg_dump` і взагалі все, що хоче один знімок на весь час роботи.** Дамп — це довга послідовність
   запитів, яка мусить бачити узгоджену картину; transaction mode цього не обіцяє. Тому
   [`scripts/backup.sh`](scripts/backup.sh) свідомо йде повз пулер.
4. **Довгі транзакції пінять бекенд на весь свій час.** [`src/concurrency/worker.ts`](src/concurrency/worker.ts)
   тримає транзакцію відкритою на весь handler (`FOR UPDATE SKIP LOCKED` + обробка), тож
   `default_pool_size` стає стелею паралелізму воркерів: при чотирьох воркерах і `default_pool_size = 5`
   `npm run demo:workers` дає 2.30× прискорення, а от пʼятий-шостий воркер уже чекав би в черзі.

Окремо — те, що ламається не в застосунку, а в експлуатації: `SELECT pg_backend_pid()` через пулер
повертає PID, який наступного разу буде іншим, а `pg_stat_activity` показує зʼєднання пулера, а не
клієнтів. Шукати «хто тримає локи» тепер треба у два кроки.

Міграції через пулер проходять нормально (`npm run migrate` — це DDL в одній транзакції), але в
проді їх варто пускати прямо в 5433: міграція не має конкурувати за пʼять зʼєднань із застосунком.

## Ротація пароля і пулер

PgBouncer автентифікує клієнтів за власним списком, тому [`rotate.sh`](rotate.sh) із ДЗ #2 отримав
четвертий крок — інакше `ALTER ROLE` відпрацював би, а кожне зʼєднання через 6432 почало б падати з
`SASL authentication failed`. Порядок тепер такий: `ALTER ROLE` → файл із паролем → розрив старих
зʼєднань → **userlist пулера + SIGHUP**. Без рестарту, як і було обіцяно в розділі
[«Ротація пароля БД без рестарту»](#ротація-пароля-бд-без-рестарту):

```
$ bash rotate.sh
1/4 ALTER ROLE invest_app …
2/4 updating ./secrets/db_password …
3/4 terminating existing connections of role invest_app …
4/4 updating the PgBouncer userlist …
    userlist rewritten in the running container, SIGHUP sent
Done: password rotated, connections terminated: 1. No restart needed.
```

Ротоване значення не потрапляє в git. [`pgbouncer/userlist.txt`](pgbouncer/userlist.txt) монтується
read-only як `userlist.seed.txt`, контейнер на старті копіює його у записуваний `auth_file`, і
`rotate.sh` переписує саме копію — так само, як сам пароль живе в `secrets/db_password`, а не у
відстежуваному файлі. `docker compose up` повертає дев-дефолт із seed-файла.

Чому в userlist plaintext, а не SCRAM-верифікатори: верифікатором можна перевірити клієнта, але не
можна залогінитись на сервер — PgBouncer не знає з нього пароля. Обидва значення тут і так відкриті
(`docker-compose.yml` і `db/init.sql`), це дев-креденшели, не прод-секрети.

## Grading

Той самий контракт, що в ДЗ #13 і #14: у грейдера немає доступу до сховища (Infisical, ДЗ #11), тому
`SKIP_VAULT=1` перемикає [`scripts/with-secrets.sh`](scripts/with-secrets.sh) на прямий `exec`, а
підключення береться з дев-креденшелів `docker-compose.yml` (вони не є секретом). **Порт 6432** — це
PgBouncer; Postgres лишається на 5433 для адмін-задач.

```bash
docker compose up -d --wait
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:6432/invest
export SKIP_VAULT=1    # у грейдера немає доступу до сховища
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Скрипти читають `DATABASE_URL` прямо з оточення, тому голий `bash scripts/backup.sh` після цих
`export` теж працює — обгортка під `SKIP_VAULT=1` просто виконує його. Обидва запуски дають код 0;
`backup.sh` друкує шлях створеного дампу останнім рядком, `restore-drill.sh` — `MATCH`. Drill можна
запускати повторно: контейнер і том він створює й зносить сам.

Перевірка самого пулера — **саме в цьому порядку**, бо пул для `invest` зʼявляється лише після
першого клієнта:

```bash
psql -h 127.0.0.1 -p 6432 -U postgres -d invest     -c "SELECT 1"
psql -h 127.0.0.1 -p 6432 -U postgres -d pgbouncer  -c "SHOW POOLS"
```

Пароль для обох — `postgres` (`PGPASSWORD=postgres`, або введи в запиті). Другий рядок має показати
базу `invest` із `pool_mode = transaction`.

Щоб побачити, що через пулер ходить і сам застосунок — той самий набір, що в ДЗ #14, але з портом
6432:

```bash
npm ci
npm run build
export DB_HOST=127.0.0.1 DB_PORT=6432 DB_USER=postgres DB_PASSWORD=postgres DB_NAME=invest
npm run migrate
npm run seed
npm run demo:race
npm run demo:workers
```

## Структура ДЗ #15

| Шлях | Призначення |
|---|---|
| [`pgbouncer/pgbouncer.ini`](pgbouncer/pgbouncer.ini) | конфіг пулера: `pool_mode = transaction`, `default_pool_size = 5`, `max_client_conn = 200`, адмін-консоль |
| [`pgbouncer/userlist.txt`](pgbouncer/userlist.txt) | seed-список користувачів; у контейнері з нього робиться записувана копія |
| [`docker-compose.yml`](docker-compose.yml) | сервіс `pgbouncer` із опублікованим портом 6432 і healthcheck через адмін-консоль |
| [`scripts/lib/db-url.sh`](scripts/lib/db-url.sh) | резолвер підключення (`DATABASE_URL` → `DB_*` → `DB_URL`) + запуск клієнтів у контейнері |
| [`scripts/backup.sh`](scripts/backup.sh) | `pg_dump -Fc` у датований файл, atomic rename, ротація старих дампів |
| [`scripts/restore-drill.sh`](scripts/restore-drill.sh) | відновлення в чистий том, звірка контрольних значень, `MATCH` або exit ≠ 0 |
| [`backup.cron`](backup.cron) | нічний розклад — джерело RPO ≤ 24 год |
| [`RESTORE-DRILL.md`](RESTORE-DRILL.md) | протокол прогону: дата, розмір, час, RTO і RPO числами |
| [`rotate.sh`](rotate.sh) | + крок 4/4: userlist пулера і SIGHUP, щоб ротація лишалась безрестартною |

---

# Домашнє завдання #16 — драбинка довіри: testcontainers, E2E, Pact

Моки більше не єдине джерело впевненості. Чотири шари, кожен зі своєю командою, кожен
проти справжнього Postgres, піднятого з коду тесту.

## Команди

| Команда | Що робить | Що піднімає |
|---|---|---|
| `npm test` | юніт: контролери/сервіси з мокнутими залежностями — 46 тестів | нічого |
| `npm run test:integration` | три репозиторії проти `postgres:16-alpine` — 14 тестів | testcontainer |
| `npm run test:e2e` | наскрізний HTTP через supertest — 11 тестів | testcontainer |
| `npm run test:contract` | consumer-тест → `pacts/invest-web-invest-api.json` | pact mock server |
| `npm run verify:provider` | справжній застосунок проти контракту | testcontainer + `app.listen(0)` |

Єдина зовнішня залежність усіх чотирьох — запущений Docker. `DATABASE_URL` у тестах
свідомо **не** береться зі сховища: його видає контейнер у рантаймі
(`container.getConnectionUri()`), і саме в цьому сенс шару. Сховище лишається джерелом
для звичайного запуску застосунку (`npm start`, `npm run migrate`, `npm run seed`).

```
test/
├── testkit/     контейнер, міграції, фікстури, test data builders
├── integration/ accounts / fx-rate / transactions repository
├── e2e/         supertest проти повного AppModule
└── contract/    consumer-тест і provider verification
pacts/           згенерований контракт (комітиться — див. нижче)
```

## Стратегія ізоляції і чому саме вона

**Контейнер-на-конфіг через `globalSetup` + `TRUNCATE … RESTART IDENTITY CASCADE` у
`beforeEach` integration-шару.** Стратегію «транзакція-ROLLBACK» тут підключити нікуди:
репозиторії отримують TypeORM `Repository<T>` з DI-контейнера Nest, а `TransactionsService`
відкриває власну транзакцію всередині себе — обгорнути її ззовні можна лише переписавши
прод-код, чого одне ДЗ з тестування не варте. `TRUNCATE` натомість працює на рівні БД:
після нього не лишається нічого навіть тоді, коли тест упав посеред власної транзакції.
Контейнер піднімається один на весь конфіг (кожен jest-воркер множив би контейнери, тому
`maxWorkers: 1`) і вмирає разом із прогоном, тож `npm run test:integration && npm run
test:integration` зелений без жодної ручної чистки — другий прогін просто бачить новий
Postgres.

E2E-шар навмисно **не** труncat-ить між тестами: свіжий контейнер уже дає ізоляцію між
прогонами, а частина кейсів (idempotency-replay, проба «баланс не змінився після відкату»)
саме на накопиченому стані й тримається.

`globalSetup` виконується в батьківському процесі Jest — воркери форкаються після нього й
успадковують `process.env`. Це єдина причина, чому контейнер піднімається там, а не в
`beforeAll`: `src/data-source.ts` резолвить підключення **на рівні модуля** і кидає на
`import`, якщо оточення порожнє.

## Test data builders

`test/testkit/builders.ts` — `aUser()`, `anAccount()`, `anInstrument()`, `anFxRate()`,
`anEntry()`. Кожен дефолт валідний сам по собі й унікальний на виклик (`randomUUID()` для
id, лічильник для `email`/`symbol`), тож тест називає лише те поле, про яке він насправді.
Ніяких стін фікстур і ніяких випадкових колізій із рядком, що лишився від сусіднього тесту.

## Що ловлять integration-тести і не ловить мок

| Тест | Механізм, якого у мока немає |
|---|---|
| `accounts` → неіснуючий `user_id` | FK `23503` на `accounts.user_id → users(id)` |
| `accounts` → повторний id | `23505` duplicate key на PK |
| `fx-rate` → повторний upsert того самого дня | `ON CONFLICT (source, currency, rate_date) DO UPDATE` |
| `fx-rate` → JPY за 100 одиниць | генерована колонка `rate = (raw_rate / raw_units)::numeric(20,10) STORED` |
| `fx-rate` → два джерела на одну дату | `DISTINCT ON … ORDER BY source ASC` у сирому SQL |
| `fx-rate` → курс для `UAH` | CHECK `fx_rate_base_is_not_quoted` (`23514`) |
| `transactions` → читання `instrument_symbol` | JOIN через `relations: { instrument: true }` |
| `transactions` → USD-рядок на UAH-рахунку | композитний FK `transactions_currency_matches_account` |

## Контракт

Consumer — уявний фронтенд `invest-web`; provider — цей застосунок. Один interaction:
`GET /accounts/{account_id}` з provider state `account 1111… exists`. Шлях і форма
відповіді взяті зі спеки ДЗ #9 (`openapi/openapi.yaml` → `#/components/schemas/Account`);
значення описані матчерами `MatchersV3`, а не літералами, щоб новий рядок у базі не ламав
контракт.

`pacts/invest-web-invest-api.json` **комітиться**: так `npm run verify:provider` працює на
свіжому клоні без попереднього `npm run test:contract`. CI все одно перегенеровує його
перед публікацією.

Provider verification ганяє **справжній** застосунок — той самий `createApp()`, що викликає
`main.ts`, разом із валідатором запитів і відповідей. `stateHandlers` сідають БД через
`resetDb()` (усі INSERT-и — `ON CONFLICT DO NOTHING`), тож стан можна програвати скільки
завгодно разів.

Перевірка, що шлях кожного interaction існує у спеці, — окремий крок CI
(`Check every interaction path exists in the OpenAPI spec`).

## Брокер локально

```bash
docker compose up -d --wait        # postgres, pgbouncer, pact-broker-db, pact-broker
open http://127.0.0.1:9292
```

Брокер має власний Postgres (`pact-broker-db`), а не другу базу в основному: `db/init.sql`
відпрацьовує лише при створенні тому `pgdata`, тож на наявному томі нова база була б
невидимою. У healthcheck — `127.0.0.1`, не `localhost`: усередині контейнера `localhost`
може резолвитись у `::1`, а puma слухає лише IPv4, і `--wait` висів би назавжди.

Локальний брокер піднімається **без auth** — він слухає тільки на localhost, і рецепти з
`curl` нижче мають працювати дослівно. Хостовий брокер адресується через
`PACT_BROKER_TOKEN`.

## Секрети

Код читає рівно `process.env.PACT_BROKER_URL` і `process.env.PACT_BROKER_TOKEN` —
ані адреси, ані токена в репозиторії немає. Два легальні шляхи їх передати:

```bash
# Основний: значення приїжджають зі сховища ДЗ #11 через ту саму обгортку
bash scripts/with-secrets.sh dev npm run verify:provider

# Аварійний (і те, що робить грейдер — доступу до сховища в нього немає):
PACT_BROKER_URL=http://127.0.0.1:9292 npm run verify:provider
```

Під `SKIP_VAULT=1` обгортка виконує рівно ту саму команду, що й друга форма. У CI обидві
змінні приходять із GitHub secrets (`.github/workflows/ci.yml`).

Без `PACT_BROKER_URL` верифаєр читає закомічений `pacts/*.json` і нікуди не публікує — саме
тому `npm run verify:provider` зелений на голому клоні.

## Гейт `can-i-deploy` — обидва стани

Порядок кроків обовʼязковий: `to=prod` питає «чи є перевірений контракт із тією версією
провайдера, що зараз у prod», і поки жодну версію провайдера не позначено тегом, чесна
відповідь брокера — `unknown`.

```bash
docker compose up -d --wait
export PACT_BROKER_URL=http://127.0.0.1:9292
SHA=$(git rev-parse --short HEAD)

# 1. публікація контракту
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT \
  "$PACT_BROKER_URL/pacts/provider/invest-api/consumer/invest-web/version/$SHA" \
  -H 'Content-Type: application/json' -d @pacts/invest-web-invest-api.json
# 201

# 2. верифікація з publishVerificationResult: true
npm run verify:provider     # exit 0

# 3. ДО тега prod
curl -sS "$PACT_BROKER_URL/can-i-deploy?pacticipant=invest-web&version=$SHA&to=prod"
```

```json
{"summary":{"deployable":null,"reason":"There is no verified pact between version 581cc6e of invest-web and the latest version of invest-api with tag prod (no such version exists)","success":0,"failed":0,"unknown":1}, ...}
```

```bash
# 4. тег ставиться на версію ПРОВАЙДЕРА, і саме на той providerVersion,
#    який передано у Verifier (git rev-parse --short HEAD)
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT \
  "$PACT_BROKER_URL/pacticipants/invest-api/versions/$SHA/tags/prod" \
  -H 'Content-Type: application/json'
# 201

# 5. ПІСЛЯ тега prod
curl -sS "$PACT_BROKER_URL/can-i-deploy?pacticipant=invest-web&version=$SHA&to=prod"
```

```json
{"summary":{"deployable":true,"reason":"All required verification results are published and successful","success":1,"failed":0,"unknown":0}, ...}
```

`unknown: 1` → `deployable: true` — це й є доказ, що гейт справжній, а не завжди-зелений.
Ту саму пару робить `scripts/can-i-deploy.sh`, який падає з exit 1 на всьому, крім
`"deployable": true`:

```bash
bash scripts/can-i-deploy.sh invest-web "$SHA" prod   # exit 0
bash scripts/can-i-deploy.sh invest-web no-such-ver prod
# can-i-deploy: NOT deployable (deployable=false, unknown=0, failed=0) → exit 1
```

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — дві джоби:

- **test** — `npm ci` → `npx tsc --noEmit` → `test:integration` → `test:e2e`. Service-контейнерів немає: обидві сюїти піднімають Postgres самі.
- **contract** (`needs: test`) — брокер → `test:contract` → звірка шляхів зі спекою → publish → `verify:provider` з `publishVerificationResult: true` → тег `prod` → **`can-i-deploy`**, який валить джобу, якщо `deployable` не `true`.

`DEBUG=testcontainers*` у CI свідомо не вмикається: бібліотека продовжує логувати після
завершення тестів, jest ловить «Cannot log after tests are done» і повертає exit 1 при всіх
зелених тестах.

## Репортер

`reporters: ['default']` стоїть у `jest.config.js` і в кожному з чотирьох конфігів у
`test/`. Без цього рядка Jest 30 обирає репортер сам, за змінними оточення, і в частині
середовищ вмикає компактний `agent`: той не друкує ні `PASS <файл>`, ні назв `describe`/`it`,
ні `✓` — лишається сам підсумок `Tests: N passed`.
