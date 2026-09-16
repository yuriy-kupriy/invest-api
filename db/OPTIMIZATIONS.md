# ДЗ #12 — три повільні запити: EXPLAIN до і після

Числа зняті на цій машині (Apple Silicon, Docker Desktop, `postgres:16-alpine`, налаштування за
замовчуванням) на базі після `db/schema.sql` + `db/seed.sql`: **500 000 транзакцій**, 60 000
рахунків, 20 000 користувачів.

Порядок прогону — рівно той, що виконує грейдер: чистий том → `schema.sql` → `seed.sql` →
EXPLAIN «до» → `indexes.sql` → `ANALYZE` → EXPLAIN «після». Усі шість планів нижче зняті **в
одному прогоні на одних і тих самих даних**: `db/seed.sql` детермінований (усі псевдовипадкові
рішення — чисті функції від номера рядка), тож «до» і «після» дивляться на однакову таблицю.

Обидва заміри теплі — кожен план знімався з другого прогону поспіль. Перший прогін «після» ще тягне
щойно створені сторінки індексу з диска (`read=3` замість `hit`), і порівнювати теплий Seq Scan із
холодним Index Scan було б нечесно на користь індексу.

## Підсумок

| Запит | Що робить | Час до | Час після | Прискорення | Buffers до | Buffers після |
|---|---|---:|---:|---:|---:|---:|
| q1 | виписка по рахунку за квартал | 47.085 мс | **1.293 мс** | **×36** | 9 174 | **53** |
| q2 | черга операцій у статусі `pending` | 45.231 мс | **2.445 мс** | **×18** | 9 158 | **102** |
| q3 | пошук рахунку без урахування регістру | 15.920 мс | **0.087 мс** | **×183** | 864 | **4** |

Найпоказовіше тут не мілісекунди, а buffers: вони не залежать від навантаження на машину й падають
у 90–216 разів.

---

## q1 — виписка по рахунку за період

`db/queries/q1.sql` — це буквально `GET /transactions?account_id=…` з keyset-пагінацією
`(booked_at, id) DESC`, тією самою, що описана в `src/shared/pagination.ts`.

```sql
SELECT id, account_id, type, amount_cents, currency, fx_rate, booked_at
FROM transactions
WHERE account_id = '88d96ab3-2fd0-7165-9d4c-8ce24172488a'
  AND booked_at >= '2026-01-01'
  AND booked_at <  '2026-04-01'
ORDER BY booked_at DESC, id DESC
LIMIT 50
```

### До

```
 Limit  (cost=13734.44..13740.28 rows=50 width=65) (actual time=41.426..46.976 rows=50 loops=1)
   Buffers: shared hit=9174
   ->  Gather Merge  (cost=13734.44..13766.64 rows=276 width=65) (actual time=41.425..46.971 rows=50 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=9174
         ->  Sort  (cost=12734.42..12734.76 rows=138 width=65) (actual time=37.246..37.249 rows=42 loops=3)
               Sort Key: booked_at DESC, id DESC
               Sort Method: top-N heapsort  Memory: 36kB
               Buffers: shared hit=9174
               Worker 0:  Sort Method: top-N heapsort  Memory: 36kB
               Worker 1:  Sort Method: top-N heapsort  Memory: 37kB
               ->  Parallel Seq Scan on transactions  (cost=0.00..12729.83 rows=138 width=65) (actual time=0.157..36.998 rows=113 loops=3)
                     Filter: ((booked_at >= '2026-01-01 00:00:00+00'::timestamp with time zone) AND (booked_at < '2026-04-01 00:00:00+00'::timestamp with time zone) AND (account_id = '88d96ab3-2fd0-7165-9d4c-8ce24172488a'::uuid))
                     Rows Removed by Filter: 166554
                     Buffers: shared hit=9084
 Planning:
   Buffers: shared hit=129
 Planning Time: 0.930 ms
 Execution Time: 47.085 ms
```

### Після

```
 Limit  (cost=0.42..200.27 rows=50 width=65) (actual time=0.052..1.243 rows=50 loops=1)
   Buffers: shared hit=53
   ->  Index Scan using transactions_account_booked_idx on transactions  (cost=0.42..1251.44 rows=313 width=65) (actual time=0.051..1.239 rows=50 loops=1)
         Index Cond: ((account_id = '88d96ab3-2fd0-7165-9d4c-8ce24172488a'::uuid) AND (booked_at >= '2026-01-01 00:00:00+00'::timestamp with time zone) AND (booked_at < '2026-04-01 00:00:00+00'::timestamp with time zone))
         Buffers: shared hit=53
 Planning:
   Buffers: shared hit=171
 Planning Time: 1.200 ms
 Execution Time: 1.293 ms
```

**Що змінилось.** Зникла вся надбудова `Gather Merge → Sort → Parallel Seq Scan`: індекс
`(account_id, booked_at DESC, id DESC)` віддає рядки вже в потрібному порядку, тому `top-N
heapsort` більше не потрібен, а разом із сортуванням відпала й потреба у двох паралельних воркерах —
планер наймав їх лише щоб швидше перелопатити таблицю. Buffers упали з 9 174 до 53 (×173): замість
читання всіх 9 084 сторінок таблиці з відкиданням 166 554 рядків на воркера (`Rows Removed by
Filter`) запит спускається по дереву індексу й піднімає рівно ті 50 рядків, які просить `LIMIT`.

---

## q2 — черга незавершених операцій

`db/queries/q2.sql`. Статус `pending` — це 2.18% таблиці (10 917 із 500 000): рівно той перекіс,
під який має сенс partial-індекс.

```sql
SELECT id, account_id, amount_cents, currency, booked_at
FROM transactions
WHERE status = 'pending'
ORDER BY booked_at DESC
LIMIT 100
```

### До

```
 Limit  (cost=12862.28..12873.95 rows=100 width=52) (actual time=40.710..45.120 rows=100 loops=1)
   Buffers: shared hit=9158
   ->  Gather Merge  (cost=12862.28..13925.19 rows=9110 width=52) (actual time=40.709..45.113 rows=100 loops=1)
         Workers Planned: 2
         Workers Launched: 2
         Buffers: shared hit=9158
         ->  Sort  (cost=11862.26..11873.64 rows=4555 width=52) (actual time=35.972..35.976 rows=80 loops=3)
               Sort Key: booked_at DESC
               Sort Method: top-N heapsort  Memory: 46kB
               Buffers: shared hit=9158
               Worker 0:  Sort Method: top-N heapsort  Memory: 47kB
               Worker 1:  Sort Method: top-N heapsort  Memory: 47kB
               ->  Parallel Seq Scan on transactions  (cost=0.00..11688.17 rows=4555 width=52) (actual time=0.045..35.316 rows=3639 loops=3)
                     Filter: (status = 'pending'::text)
                     Rows Removed by Filter: 163028
                     Buffers: shared hit=9084
 Planning:
   Buffers: shared hit=124
 Planning Time: 0.880 ms
 Execution Time: 45.231 ms
```

### Після

```
 Limit  (cost=0.29..251.12 rows=100 width=52) (actual time=0.049..2.387 rows=100 loops=1)
   Buffers: shared hit=102
   ->  Index Scan using transactions_pending_booked_idx on transactions  (cost=0.29..28135.90 rows=11217 width=52) (actual time=0.048..2.379 rows=100 loops=1)
         Buffers: shared hit=102
 Planning:
   Buffers: shared hit=163
 Planning Time: 1.147 ms
 Execution Time: 2.445 ms
```

**Що змінилось.** Зник `Sort` разом із `Gather Merge`, а `Parallel Seq Scan` замінився на
`Index Scan`. Найпоказовіше — у плані **немає рядка `Filter`**: умова `status = 'pending'` не
перевіряється на рядках узагалі, вона «вшита» в означення partial-індексу, тож кожен запис, до
якого запит дотягується, за побудовою вже підходить. Buffers упали з 9 158 до 102 (×90). Сам індекс
важить **448 kB** проти 28 MB у складеного індексу по `transactions` — плата за 2.18% рядків, а не
за всі 100%.

---

## q3 — пошук рахунку без урахування регістру

`db/queries/q3.sql`. Це той випадок, про який попереджає завдання: індекс по колонці `name` тут не
допоміг би взагалі, бо у `WHERE` стоїть функція.

```sql
SELECT id, user_id, name, type, currency, balance_cents
FROM accounts
WHERE lower(name) = lower('OSCHADBANK UAH #4821')
```

### До

```
 Seq Scan on accounts  (cost=0.00..1764.00 rows=300 width=68) (actual time=1.288..15.864 rows=1 loops=1)
   Filter: (lower(name) = 'oschadbank uah #4821'::text)
   Rows Removed by Filter: 59999
   Buffers: shared hit=864
 Planning:
   Buffers: shared hit=75
 Planning Time: 0.772 ms
 Execution Time: 15.920 ms
```

### Після

```
 Index Scan using accounts_lower_name_idx on accounts  (cost=0.41..8.43 rows=1 width=68) (actual time=0.035..0.035 rows=1 loops=1)
   Index Cond: (lower(name) = 'oschadbank uah #4821'::text)
   Buffers: shared hit=4
 Planning:
   Buffers: shared hit=100
 Planning Time: 0.811 ms
 Execution Time: 0.087 ms
```

**Що змінилось.** `Seq Scan` став `Index Scan`, а `Filter` перетворився на `Index Cond` — і це не
косметика, а вся суть: `Filter` означає «прочитали рядок і відкинули», `Index Cond` означає «навіть
не читали». Було 59 999 відкинутих рядків і 864 сторінки, стало 4 сторінки (×216) — три рівні
дерева індексу плюс одна сторінка таблиці. Оцінка планера теж стала чесною: `rows=300` — це сліпий
здогад про селективність невідомого виразу (0.5% від таблиці за замовчуванням), а після створення
expression-індексу Postgres збирає статистику по самому виразу й дає точну `rows=1`.

---

## Про типи: чому суми `bigint`, а курси `numeric`

Коротко, бо це видно просто в схемі й може здатися непослідовністю.

**Float у схемі немає ніде** — саме це й захищає «Don't Do This».

Суми — `bigint` у мінімальних одиницях (`amount_cents`, `balance_cents`, `quantity_micro`):
мінімальна одиниця тут задана валютою об'єктивно, її знає ISO 4217 (колонка `currency.exponent`).
Тип фіксованої довжини й pass-by-value дає вужчий рядок і швидше сортування на 500 000 рядків, а
контракт `openapi.yaml` уже оголошує ці поля як `integer/int64` — БД і дріт говорять одним типом.
Запас перевірено: стеля `bigint` — 92 233 720 368 547 758 грн, у 23 058 разів більше за весь
держбюджет України; мільйон гривень — це 10⁸ копійок, одна десятимільярдна частка діапазону.

Курси й ціни — `numeric(20,10)`: у курсу природної мінімальної одиниці не існує, будь-який множник
був би вигаданий і жив би в коментарі, а не в типі. До того ж крос-курс `amount × rate_from /
rate_to` на чистих цілих переповнюється (перевірено: `bigint * bigint * bigint` дає `ERROR: bigint
out of range`), а цілочисельне ділення при цьому мовчки обрізає. З `numeric`-курсом множення саме
підіймається в numeric (`pg_typeof(bigint * numeric)` → `numeric`, `sum(bigint)` → `numeric`), тож
переповнення не виникає.

Ціна рішення названа чесно: це шов між двома моделями рівно там, де відбувається множення, і
правило округлення при конверсії доведеться тримати в одному місці (ДЗ #14).

---

## Аудит: чи немає індексів «про запас»

```
docker compose exec -T postgres psql -U postgres -d invest \
  -c "SELECT indexrelname, idx_scan FROM pg_stat_user_indexes WHERE idx_scan = 0 ORDER BY indexrelname;"
```

```
       indexrelname        | idx_scan 
---------------------------+----------
 categories_name_key       |        0
 currency_numeric_code_key |        0
 health_probe_pkey         |        0
 instruments_symbol_key    |        0
 transactions_pkey         |        0
 users_email_key           |        0
```

Усі шість нулів — це індекси, які **підпирають констрейнти** (PRIMARY KEY і UNIQUE), а не
оптимізаційні. Postgres створює їх сам разом із констрейнтом, і прибрати їх не можна, не знявши сам
констрейнт; нуль сканувань тут означає лише те, що в цьому прогоні ніхто не шукав рахунок за `id`
чи інструмент за символом. Жодного індексу, доданого «про всяк випадок», у схемі немає.

Три оптимізаційні індекси, навпаки, використані всі:

```
          indexrelname           | idx_scan |  size   
---------------------------------+----------+---------
 accounts_lower_name_idx         |        2 | 2256 kB
 transactions_account_booked_idx |        2 | 28 MB
 transactions_pending_booked_idx |        2 | 448 kB
```

(`idx_scan = 2` — це рівно два теплі прогони EXPLAIN на індекс із замірів вище.)

Під `fx_rate` окремого індексу немає навмисно: складений первинний ключ
`(source, currency, rate_date)` уже обслуговує єдиний патерн доступу до курсів —
`WHERE source = ? AND currency = ? AND rate_date <= ? ORDER BY rate_date DESC LIMIT 1`.
