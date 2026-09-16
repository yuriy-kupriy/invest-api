import { FxRateCache } from './fx-rate.cache';
import { addDays } from './fx-sync.service';

describe('FxRateCache', () => {
  let cache: FxRateCache;

  beforeEach(() => {
    cache = new FxRateCache();
    cache.load([
      { currency: 'EUR', rateDate: '2026-01-01', rate: '45.0000000000', source: 'nbu' },
      { currency: 'USD', rateDate: '2026-01-01', rate: '41.5000000000', source: 'nbu' },
      { currency: 'USD', rateDate: '2026-01-02', rate: '41.6000000000', source: 'nbu' },
      { currency: 'USD', rateDate: '2026-01-05', rate: '41.9000000000', source: 'nbu' },
    ]);
  });

  it('counts every loaded rate', () => {
    expect(cache.size).toBe(4);
  });

  it('finds the exact date', () => {
    expect(cache.findLatest('USD', '2026-01-02')?.rate).toBe('41.6000000000');
  });

  it('falls back to the latest earlier date inside a gap', () => {
    expect(cache.findLatest('USD', '2026-01-04')?.rateDate).toBe('2026-01-02');
  });

  it('answers the first and last cached dates', () => {
    expect(cache.findLatest('USD', '2026-01-01')?.rate).toBe('41.5000000000');
    expect(cache.findLatest('USD', '2026-01-05')?.rate).toBe('41.9000000000');
  });

  it('delegates dates after the last cached one to the database', () => {
    expect(cache.findLatest('USD', '2026-01-06')).toBeUndefined();
  });

  it('delegates dates before the first cached one and unknown currencies', () => {
    expect(cache.findLatest('USD', '2025-12-31')).toBeUndefined();
    expect(cache.findLatest('GBP', '2026-01-02')).toBeUndefined();
  });

  it('replaces the whole index on reload', () => {
    cache.load([{ currency: 'GBP', rateDate: '2026-01-01', rate: '52.8000000000', source: 'nbu' }]);
    expect(cache.findLatest('USD', '2026-01-02')).toBeUndefined();
    expect(cache.findLatest('GBP', '2026-01-01')?.rate).toBe('52.8000000000');
  });
});

describe('addDays', () => {
  it('crosses month and year boundaries in UTC', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });
});
