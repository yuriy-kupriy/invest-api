SELECT id, account_id, amount_cents, currency, booked_at
FROM transactions
WHERE status = 'pending'
ORDER BY booked_at DESC
LIMIT 100
