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
| `test/app.e2e-spec.ts` | e2e: той самий пайплайн, що й `npm start`, без реального `listen()` |
| `scripts/check-spec.js` | перевірка обсягу спеки — той самий скрипт, що в acceptance criteria |

---

## Тести

```bash
npm test          # юніт: контролери/сервіси з мокнутим репозиторієм — 17 тестів
npm run test:e2e  # e2e: реальний пайплайн (validateRequests/Responses, Idempotency-Key,
                   # problem+json) через supertest, без мережевого порту — 7 тестів
```

Юніт-специ лежать поруч із кодом (`src/**/*.spec.ts`) — стандартна Nest CLI-конвенція.
E2e — окремо в `test/`, зі своїм `test/jest-e2e.json`, теж за замовчуванням Nest CLI: e2e
піднімає ціле дерево модулів разом із raw-Express шаром (`OpenApiValidator`, error-handler),
який юніт-тести контролерів навмисно обходять моком сервісу.

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
PRIMARY KEY (source, currency, rate_date)
```

Це не надмірність. НБУ планується як primary, Frankfurter — як backfill історії; без `source` у
ключі два джерела зіткнулися б на `(currency, rate_date)` і тихо перезаписували одне одного, тобто
зникла б рівно та можливість звіряти їх між собою, заради якої й береться друге джерело.

Цей самий PK і є єдиним потрібним індексом: `WHERE source = ? AND currency = ? AND rate_date <= ?
ORDER BY rate_date DESC LIMIT 1` — рівність по двох перших колонках, діапазон по третій, скан
індексу в зворотному напрямку. Окремий `DESC`-індекс не потрібен, і в `db/indexes.sql` його немає.

`raw_rate` + `raw_units` існують тому, що провайдери котирують не завжди за одну одиницю (JPY — за
10, HUF — за 100). `rate` — нормалізоване «UAH за 1 одиницю» — це `GENERATED ALWAYS AS … STORED`,
тож дві колонки фізично не можуть роз'їхатись.

**UAH у `fx_rate` немає взагалі** (`CHECK (currency <> 'UAH')`): це база котирування, вона живе в
`currency`, а identity-курс обробляється в місці читання. Інакше або тримаєш тисячі рядків зі
значенням «одиниця», або констрейнт обіцяє валюту, якої в таблиці насправді немає.

### Звідки брати справжні дані

| Джерело | Bulk-вивантаження | Формат |
|---|---|---|
| **НБУ** | немає | `…/statdirectory/exchange?json` — усі валюти на сьогодні; `…/exchange?valcode=USD&date=YYYYMMDD&json` — одна валюта на одну дату. Кнопка Export на сайті — це один день з UI. Історію довелось би збирати запит-за-запитом |
| **Frankfurter** | **є, CSV одним запитом** | `https://api.frankfurter.dev/v2/rates.csv?providers=NBU&base=USD&quotes=UAH&from=1999-01-04` |

Дві дрібниці, які видно тільки з живої відповіді Frankfurter і які легко проґавити:

- заголовок CSV — рівно `date,base,quote,rate`; колонки `provider` там **немає**, тож `source`
  проставляє завантажувач константою;
- `base=UAH&quotes=USD` дає **обернений** курс (0.022 USD за 1 UAH). Для рідної орієнтації НБУ
  («гривень за одиницю») потрібно `base=USD&quotes=UAH` → 44.55. Два `base` в одному запиті не
  приймаються (`422 invalid currency: USD,EUR`), тож це окремий запит на валюту.

Далі — `COPY fx_rate_staging FROM … WITH (FORMAT csv, HEADER)` і перелив у `fx_rate`.

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
| `transactions_account_booked_idx` `(account_id, booked_at DESC, id DESC)` | складений | q1 | 28 MB |
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
| q1 | виписка по рахунку за квартал | 47.085 мс | **1.293 мс** | **×36** | 9 174 → 53 |
| q2 | черга операцій у статусі `pending` | 45.231 мс | **2.445 мс** | **×18** | 9 158 → 102 |
| q3 | пошук рахунку без урахування регістру | 15.920 мс | **0.087 мс** | **×183** | 864 → 4 |

Мілісекунди залежать від навантаження на машину, тому надійніший показник — buffers: вони падають
у 90–216 разів і від навантаження не залежать узагалі.

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
