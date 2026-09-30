# Restore drill — протокол

Бекап, який ніхто не відновлював, — це гіпотеза. Нижче — протокол прогону
[`scripts/restore-drill.sh`](scripts/restore-drill.sh): він бере останній дамп, піднімає Postgres на
томі, якого секунду тому не існувало, відновлює туди дамп і звіряє контрольне значення до і після.
Скрипт сам створює контейнер і том і сам їх зносить, тому прогін повторюваний: другий запуск поспіль
теж дає `MATCH`.

Дата прогону: **2026-09-20**. Машина: Apple Silicon, Docker Desktop, Postgres 16.15 у контейнері,
дамп `pg_dump --format=custom --compress=9`.

## Зведення

| Параметр | Дев-обсяг (після `npm run seed`) | Обсяг курсового (500 050 транзакцій) |
|---|---|---|
| Рядків у `transactions` | 50 | 500 050 |
| Розмір бази | 8.2 MB | 177 MB |
| Розмір дампу | 28 156 B (28 KB), 58 TOC-записів | 13 318 943 B (13 MB) |
| Час `scripts/backup.sh` | ~1 с | **2.8 с** |
| Час `pg_restore` | 0.267 / 0.501 / 0.735 с (три прогони) | **3.799 с** |
| Повний цикл drill-у | 3–5 с | **8 с** |
| Результат | `MATCH` | `MATCH` |

Контрольне значення — один рядок, який легко порівняти очима і `[ "$BEFORE" != "$AFTER" ]`:

```
11 tables | transactions: 500050 rows | sum(amount_cents)=495011097490
```

Кількість таблиць у `public` + `count(*)` + `sum(amount_cents)` по головній таблиці. Сума потрібна
саме тому, що `count(*)` сам по собі нічого не доводить: дамп, який відновив правильну кількість
рядків із порожніми значеннями, дав би той самий `count`.

## RTO і RPO

| Показник | Значення | Звідки |
|---|---|---|
| **RTO** (виміряний, обсяг курсового) | **8 секунд** повного циклу, з них 3.8 с — сам `pg_restore` | вимір `scripts/restore-drill.sh` на 500 050 рядках |
| **RTO** (реалістичний, з людиною в циклі) | **10–15 хвилин** | 8 с відновлення + час на виявлення аварії, рішення й перемикання застосунку |
| **RPO** | **до 24 годин** | розклад у [`backup.cron`](backup.cron): `17 3 * * *`, один дамп на добу |

**RTO 8 секунд — це не той RTO, який можна обіцяти бізнесу.** Це час машинної частини: том,
контейнер, `pg_restore`, звірка. Реальний час відновлення сервісу рахується від моменту, коли база
померла, а не від моменту, коли хтось запустив скрипт: аварію треба помітити (без алертів з лекції
29 це хвилини), ухвалити рішення відновлюватись, і перемкнути застосунок на відновлену базу. Чесна
оцінка — 10–15 хвилин, і саме її варто класти в SLO, а не 8 секунд.

**RPO 24 години — це прямий наслідок розкладу, а не властивість технології.** `backup.cron` знімає
дамп о 03:17, отже аварія о 03:16 коштує майже добу записів. Зменшити це число розкладом можна лише
до якоїсь межі: дамп на 177 MB займає 2.8 с, тож щогодинні дампи цілком реальні й дали б RPO ≤ 1 год,
але на базі в десятки гігабайт `pg_dump` перестає бути дешевим. Спосіб, який масштабується, —
безперервне архівування WAL і PITR: RPO падає до секунд, бо втрачається лише незаархівований сегмент.
Це поза межами ДЗ #15; об'єктне сховище для архіву приходить у #26, а алерти на «бекап не відбувся» —
у #29.

Окремо чесно: RPO 24 год вважається досягнутим тільки якщо нічний прогін справді відбувся. Зараз
нічого не перевіряє, що cron відпрацював, — рядок у `/var/log/invest-backup.log` ніхто не читає. Це
відома діра, і її закриває саме моніторинг з #29, а не ще один скрипт тут.

## Сирий вивід прогону

Дев-обсяг, два прогони поспіль — другий доводить, що скрипт прибирає за собою:

```
$ bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
Control table: transactions (sum over amount_cents)
Before: 11 tables | transactions: 50 rows | sum(amount_cents)=11097490
Dump: /Users/.../backups/invest-2026-09-20_203003.dump (28K)
Drill container: invest-restore-drill-20260920-203004 (image postgres:16-alpine, fresh volume invest-restore-drill-20260920-203004)
After:  11 tables | transactions: 50 rows | sum(amount_cents)=11097490
Restore time: 0.501 s (pg_restore only)
Full drill: 5s (fresh volume → container → restore → verify → cleanup)
MATCH

$ bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
...
Restore time: 0.735 s (pg_restore only)
Full drill: 4s (fresh volume → container → restore → verify → cleanup)
MATCH
```

Обсяг курсового, 500 050 рядків:

```
$ bash scripts/backup.sh
Backing up invest (role postgres) → /Users/.../backups/invest-2026-09-20_203108.dump
Size:  13M
Backup: /Users/.../backups/invest-2026-09-20_203108.dump
real    0m2.777s

$ bash scripts/restore-drill.sh
Control table: transactions (sum over amount_cents)
Before: 11 tables | transactions: 500050 rows | sum(amount_cents)=495011097490
Dump: /Users/.../backups/invest-2026-09-20_203108.dump (13M)
Drill container: invest-restore-drill-20260920-203111 (image postgres:16-alpine, fresh volume invest-restore-drill-20260920-203111)
After:  11 tables | transactions: 500050 rows | sum(amount_cents)=495011097490
Restore time: 3.799 s (pg_restore only)
Full drill: 8s (fresh volume → container → restore → verify → cleanup)
MATCH
```

Порожня база (лише `db/init.sql`, без міграцій) — той самий скрипт, контрольна таблиця
підбирається на льоту, бо грейдер має право запустити drill одразу після `docker compose up`:

```
$ bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
Control table: health_probe (sum over id)
Before: 1 tables | health_probe: 1 rows | sum(id)=1
...
MATCH
```

## Що drill ловить, а що ні

Ловить: битий або обрізаний дамп, дамп із порожніми таблицями, дамп, який не відновлюється в чистий
кластер через власників об'єктів (`--no-owner`) і через `GRANT` ролі, якої в новому кластері немає
(`--no-acl` — ролі кластерні, а дамп однієї бази несе `GRANT`, але не `CREATE ROLE`).

Не ловить: втрату самих ролей і їхніх паролів (`pg_dumpall --roles-only` тут немає), налаштування
кластера, і будь-що, що сталося з даними між нічним дампом і аварією — це і є RPO.
