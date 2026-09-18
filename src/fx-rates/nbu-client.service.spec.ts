import { ConfigService } from '@nestjs/config';
import { Env } from '@/config/env.schema';
import { NbuClient, parseNbuDate, parseNbuResponse } from './nbu-client.service';

const jpy = { code: 'JPY', numericCode: 392 };

describe('parseNbuResponse', () => {
  it('maps dd.mm.yyyy dates and keeps the per-units quote as raw_rate/raw_units', () => {
    const rows = parseNbuResponse(
      [
        { exchangedate: '01.01.1999', r030: 392, cc: 'JPY', txt: 'Єна', rate: 29.7123, units: 1000, calcdate: ' ' },
        { exchangedate: '02.01.1999', r030: 392, cc: 'JPY', txt: 'Єна', rate: 29.7123, units: 1000, calcdate: ' ' },
      ],
      jpy,
    );

    expect(rows).toEqual([
      { currency: 'JPY', rateDate: '1999-01-01', rawRate: '29.7123', rawUnits: 1000 },
      { currency: 'JPY', rateDate: '1999-01-02', rawRate: '29.7123', rawUnits: 1000 },
    ]);
  });

  it('returns no rows for an empty range', () => {
    expect(parseNbuResponse([], jpy)).toEqual([]);
  });

  it('rejects a record for a different currency than requested', () => {
    expect(() =>
      parseNbuResponse([{ exchangedate: '01.01.2024', r030: 840, cc: 'USD', rate: 38.002, units: 1 }], jpy),
    ).toThrow(/USD/);
  });

  it('accepts a record whose r030 differs from the requested numericCode, as long as cc matches', () => {
    // Real NBU quirk, found live: valcode=gel returns r030=381 for dates before
    // ~2002-09 and r030=981 (GEL's actual ISO 4217 numeric code) after — an
    // NBU-internal code from before some migration on their end, not a mixed-up
    // currency. `cc` is what's actually checked; see nbu-client.service.ts.
    const gel = { code: 'GEL', numericCode: 981 };
    const rows = parseNbuResponse(
      [{ exchangedate: '01.01.1999', r030: 381, cc: 'GEL', rate: 2.07697, units: 1 }],
      gel,
    );
    expect(rows).toEqual([{ currency: 'GEL', rateDate: '1999-01-01', rawRate: '2.07697', rawUnits: 1 }]);
  });

  it('rejects a malformed body instead of writing garbage', () => {
    expect(() => parseNbuResponse({ message: 'error' }, jpy)).toThrow();
    expect(() =>
      parseNbuResponse([{ exchangedate: '2024-01-01', r030: 392, cc: 'JPY', rate: 1, units: 1 }], jpy),
    ).toThrow();
  });
});

describe('parseNbuDate', () => {
  it('reorders day, month, year', () => {
    expect(parseNbuDate('17.09.2026')).toBe('2026-09-17');
  });
});

describe('NbuClient.fetchRates', () => {
  function makeConfig(): ConfigService<Env, true> {
    const values: Record<string, unknown> = { NBU_BASE_URL: 'https://bank.gov.ua', NBU_TIMEOUT_MS: 30000 };
    return { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  }

  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('builds the exchange_site URL from the configured base, currency, and date range', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const client = new NbuClient(makeConfig());
    await client.fetchRates(jpy, '1999-01-01', '2026-09-17');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestedUrl] = fetchMock.mock.calls[0] as [URL];
    expect(requestedUrl.origin + requestedUrl.pathname).toBe('https://bank.gov.ua/NBU_Exchange/exchange_site');
    expect(Object.fromEntries(requestedUrl.searchParams)).toEqual({
      start: '19990101',
      end: '20260917',
      valcode: 'jpy',
      sort: 'exchangedate',
      order: 'asc',
      json: '',
    });
  });

  it('parses a successful response through parseNbuResponse', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([{ exchangedate: '01.01.1999', r030: 392, cc: 'JPY', rate: 29.7123, units: 1000 }]),
    }) as unknown as typeof fetch;

    const rows = await new NbuClient(makeConfig()).fetchRates(jpy, '1999-01-01', '1999-01-01');
    expect(rows).toEqual([{ currency: 'JPY', rateDate: '1999-01-01', rawRate: '29.7123', rawUnits: 1000 }]);
  });

  it('throws on a non-OK HTTP response instead of parsing garbage', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;

    await expect(new NbuClient(makeConfig()).fetchRates(jpy, '1999-01-01', '2026-09-17')).rejects.toThrow(
      /HTTP 503/,
    );
  });
});
