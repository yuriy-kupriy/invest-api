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

Брокерський рахунок — це `account.type = brokerage`, купівля паперів — `transaction.type = buy`
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

| Рахунок | id | Валюта |
|---|---|---|
| Готівка UAH (`cash`) | `11111111-1111-4111-8111-111111111111` | UAH |
| Брокерський IBKR (`brokerage`) | `22222222-2222-4222-8222-222222222222` | USD |
| Квартира на Печерську (`property`) | `33333333-3333-4333-8333-333333333333` | USD |

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
| `scripts/check-spec.js` | перевірка обсягу спеки — той самий скрипт, що в acceptance criteria |

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
`{ c: <ключ сортування>, id }`, keyset за складеним ключем `(occurred_at, id) DESC`.

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
  -d '{"entries":[{"account_id":"11111111-1111-4111-8111-111111111111","type":"expense","amount_cents":1250,"currency":"UAH","occurred_at":"2026-08-25T10:00:00.000Z"}]}'
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
  -d '{"entries":[{"account_id":"11111111-1111-4111-8111-111111111111","type":"expense","amount_cents":1250,"currency":"UAH","occurred_at":"2026-08-25T10:00:00.000Z","description":"Обід"}]}'
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
- БД — сховище in-memory, як дозволяє умова; схема проєктується в ДЗ #12.
# invest-api
