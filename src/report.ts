import dataSource from './data-source';

interface CategoryReportRow {
  category: string;
  kind: string;
  txCount: string;
  totalUahMinor: string;
}

/**
 * Turnover per category, in UAH minor units (amount_cents * fx_rate), with a
 * transaction count. This can't be expressed with `find()`: it's an aggregate
 * with a GROUP BY over a joined table, not a graph of entities.
 */
async function report(): Promise<void> {
  await dataSource.initialize();

  try {
    const rows: CategoryReportRow[] = await dataSource
      .createQueryBuilder()
      .select('COALESCE(c.name, \'(uncategorized)\')', 'category')
      .addSelect('COALESCE(c.kind, \'-\')', 'kind')
      .addSelect('COUNT(t.id)', 'txCount')
      .addSelect('ROUND(SUM(t.amount_cents * t.fx_rate))::bigint', 'totalUahMinor')
      .from('transactions', 't')
      .leftJoin('categories', 'c', 'c.id = t.category_id')
      .where('t.status = :status', { status: 'posted' })
      .groupBy('c.id')
      .addGroupBy('c.name')
      .addGroupBy('c.kind')
      .orderBy('SUM(t.amount_cents * t.fx_rate)', 'DESC')
      .getRawMany();

    console.log('Turnover by category (posted transactions, UAH minor units)\n');
    console.log('category'.padEnd(22) + 'kind'.padEnd(10) + 'tx count'.padEnd(10) + 'total (UAH cents)');
    console.log('-'.repeat(70));

    for (const row of rows) {
      console.log(
        row.category.padEnd(22) + row.kind.padEnd(10) + row.txCount.padStart(6).padEnd(10) + row.totalUahMinor,
      );
    }
  } finally {
    await dataSource.destroy();
  }
}

report().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
