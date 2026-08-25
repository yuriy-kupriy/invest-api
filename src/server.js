const { createApp } = require('./app');

const PORT = Number(process.env.PORT ?? 3000);

createApp().listen(PORT, () => {
  console.log(`invest-api слухає http://localhost:${PORT}`);
  if (process.env.DRIFT === '1') {
    console.log('DRIFT=1 — мапер транзакції навмисно віддає amountCents замість amount_cents');
  }
});
