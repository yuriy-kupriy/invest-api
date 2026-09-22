import { TypeOrmModule } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { FxRate } from '@/entities/fx-rate.entity';
import { FxRateRepository } from '@/fx-rates/fx-rate.repository';
import { anFxRate } from '../testkit/builders';
import { connect, resetDb } from '../testkit/db';

/**
 * FxRateRepository is the repository whose behaviour lives almost entirely in
 * SQL: an ON CONFLICT upsert, a generated column Postgres computes, and a raw
 * `DISTINCT ON` the in-memory cache is supposed to agree with. A mock can only
 * ever return what the test already assumed.
 */
describe('FxRateRepository (integration)', () => {
  let moduleRef: TestingModule;
  let repo: FxRateRepository;
  let ds: DataSource;

  beforeAll(async () => {
    ds = await connect();
    moduleRef = await Test.createTestingModule({
      imports: [AppTypeOrmModule, TypeOrmModule.forFeature([FxRate])],
      providers: [FxRateRepository],
    }).compile();
    repo = moduleRef.get(FxRateRepository);
  });

  afterAll(async () => {
    await moduleRef.close();
    await ds.destroy();
  });

  beforeEach(async () => {
    await resetDb(ds);
    // fx_rate.currency is a foreign key into the `currency` lookup table, so a
    // rate for a currency nobody registered is rejected by the database. The
    // shared fixture only carries UAH and USD.
    await ds.query(`
      INSERT INTO currency (code, numeric_code, exponent, name) VALUES
        ('EUR', 978, 2, 'Euro'),
        ('JPY', 392, 0, 'Japanese yen')
      ON CONFLICT (code) DO NOTHING;
    `);
  });

  it('corrects a re-fetched day in place instead of duplicating it (ON CONFLICT)', async () => {
    const day = anFxRate({ rateDate: '2026-03-02', rawRate: '41.0000000000' });

    await repo.upsertMany('nbu', [day]);
    await repo.upsertMany('nbu', [{ ...day, rawRate: '42.5000000000' }]);

    const rows = await ds.query(
      `SELECT raw_rate::text AS raw FROM fx_rate
        WHERE source = 'nbu' AND currency = $1 AND rate_date = $2`,
      [day.currency, day.rateDate],
    );

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].raw)).toBe(42.5);
  });

  it('lets Postgres compute rate = raw_rate / raw_units', async () => {
    // JPY was quoted per 100 units; `rate` is GENERATED ALWAYS AS STORED, so
    // nothing in TypeScript ever divides these numbers.
    await repo.upsertMany('nbu', [
      anFxRate({ currency: 'JPY', rateDate: '2026-03-03', rawRate: '2750.0000000000', rawUnits: 100 }),
    ]);

    const found = await repo.findLatest('JPY', new Date('2026-03-03T00:00:00.000Z'));

    expect(Number(found?.rate)).toBeCloseTo(27.5, 10);
  });

  it('breaks a same-date tie by source ASC in both the SQL and the lookup path', async () => {
    await repo.upsertMany('seed-alt', [anFxRate({ rateDate: '2026-03-04', rawRate: '99.0000000000' })]);
    await repo.upsertMany('aaa-first', [anFxRate({ rateDate: '2026-03-04', rawRate: '11.0000000000' })]);

    const effective = await repo.findAllEffective();
    const picked = effective.find((row) => row.currency === 'USD' && row.rateDate === '2026-03-04');

    // findAllEffective uses DISTINCT ON ... ORDER BY source ASC; findLatest
    // uses an ORDER BY on the entity. They must agree, or the cache and the
    // database would quote different rates for the same day.
    expect(picked?.source).toBe('aaa-first');
    const latest = await repo.findLatest('USD', new Date('2026-03-04T00:00:00.000Z'));
    expect(latest?.source).toBe('aaa-first');
  });

  it('refuses to quote the base currency against itself (check constraint)', async () => {
    await expect(repo.upsertMany('nbu', [anFxRate({ currency: 'UAH' })])).rejects.toMatchObject({
      code: '23514',
      constraint: 'fx_rate_base_is_not_quoted',
    });
  });

  it('resumes a sync from the last stored date per currency', async () => {
    await repo.upsertMany('nbu', [
      anFxRate({ rateDate: '2026-03-05' }),
      anFxRate({ rateDate: '2026-03-07' }),
      anFxRate({ currency: 'EUR', rateDate: '2026-03-06' }),
    ]);

    const last = await repo.findLastDates('nbu');

    expect(last.get('USD')).toBe('2026-03-07');
    expect(last.get('EUR')).toBe('2026-03-06');
    expect(await repo.findQuotedCurrencies()).toEqual(
      expect.arrayContaining([{ code: 'USD', numericCode: 840 }]),
    );
  });
});
