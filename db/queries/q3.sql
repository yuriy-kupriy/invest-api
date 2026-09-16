SELECT id, user_id, name, type, currency, balance_cents
FROM accounts
WHERE lower(name) = lower('OSCHADBANK UAH #4821')
