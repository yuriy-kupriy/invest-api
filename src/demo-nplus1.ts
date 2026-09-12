import { DataSource, In, Logger } from 'typeorm';
import { dataSourceOptions } from './data-source';
import { Account } from './entities/account.entity';
import { Instrument } from './entities/instrument.entity';

/**
 * Counts every SQL statement TypeORM sends, so the "before" and "after" numbers
 * in the demo below come from an actual count, not eyeballing a log.
 */
class QueryCountLogger implements Logger {
  count = 0;

  logQuery(): void {
    this.count += 1;
  }

  logQueryError(): void {}
  logQuerySlow(): void {}
  logSchemaBuild(): void {}
  logMigration(): void {}
  log(): void {}
}

async function withCountedQueries<T>(
  dataSource: DataSource,
  fn: () => Promise<T>,
): Promise<{ result: T; count: number }> {
  const logger = dataSource.logger as QueryCountLogger;
  logger.count = 0;
  const result = await fn();
  return { result, count: logger.count };
}

/**
 * Naive: one query for the accounts, then one query per account for its
 * transactions, then one query per transaction for its instrument — the
 * classic query-in-a-loop, at both levels of the graph.
 */
async function naive(dataSource: DataSource, accountIds: string[]): Promise<number> {
  for (const accountId of accountIds) {
    const transactions = await dataSource
      .getRepository(Account)
      .createQueryBuilder('a')
      .relation(Account, 'transactions')
      .of({ id: accountId })
      .loadMany<{ instrumentId: string | null }>();

    for (const tx of transactions) {
      if (tx.instrumentId) {
        await dataSource.getRepository(Instrument).findOne({ where: { id: tx.instrumentId } });
      }
    }
  }

  return accountIds.length;
}

/** Fixed with `relations`: TypeORM issues a single query with LEFT JOINs. */
async function withRelations(dataSource: DataSource, accountIds: string[]): Promise<number> {
  const accounts = await dataSource.getRepository(Account).find({
    where: { id: In(accountIds) },
    relations: { transactions: { instrument: true } },
  });
  return accounts.length;
}

/** Fixed with relationLoadStrategy 'query': one query per relation level instead of a JOIN. */
async function withRelationLoadStrategyQuery(dataSource: DataSource, accountIds: string[]): Promise<number> {
  const accounts = await dataSource.getRepository(Account).find({
    where: { id: In(accountIds) },
    relations: { transactions: { instrument: true } },
    relationLoadStrategy: 'query',
  });
  return accounts.length;
}

async function run(): Promise<void> {
  const logger = new QueryCountLogger();
  const dataSource = new DataSource({ ...dataSourceOptions, logging: true, logger });
  await dataSource.initialize();

  try {
    // Fetched once, outside the counted sections below — this is setup, not
    // part of either strategy being measured.
    const allAccountIds = (await dataSource.getRepository(Account).find({ order: { createdAt: 'ASC' } })).map(
      (a) => a.id,
    );

    console.log('N+1 demo — graph: account -> transactions -> instrument (2 levels)\n');
    console.log('sample size | naive (query-in-loop) | relations/leftJoinAndSelect | relationLoadStrategy: query');
    console.log('------------|------------------------|-----------------------------|------------------------------');

    for (const n of [4, allAccountIds.length]) {
      const ids = allAccountIds.slice(0, n);
      const naiveRun = await withCountedQueries(dataSource, () => naive(dataSource, ids));
      const relRun = await withCountedQueries(dataSource, () => withRelations(dataSource, ids));
      const queryStratRun = await withCountedQueries(dataSource, () => withRelationLoadStrategyQuery(dataSource, ids));

      console.log(
        `N=${n}`.padEnd(12) +
          '| ' +
          `${naiveRun.count} queries (>= ${n})`.padEnd(23) +
          '| ' +
          `${relRun.count} query`.padEnd(28) +
          '| ' +
          `${queryStratRun.count} queries`,
      );
    }

    console.log(
      '\n"after" stays constant across N — that is the point: it does not grow with the collection size.',
    );
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
