SELECT id, account_id, type, amount_cents, currency, fx_rate, booked_at
FROM transactions
WHERE account_id = '88d96ab3-2fd0-7165-9d4c-8ce24172488a'
  AND booked_at >= '2026-01-01'
  AND booked_at <  '2026-04-01'
ORDER BY booked_at DESC, id DESC
LIMIT 50
