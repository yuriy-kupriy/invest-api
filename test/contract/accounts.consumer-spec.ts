import { MatchersV3, PactV3 } from '@pact-foundation/pact';
import { resolve } from 'node:path';

const { like, integer, uuid, datetime } = MatchersV3;

/** The account the provider state seeds — the same id db/dev-fixtures.sql uses. */
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * The consumer side of the contract: an imaginary invest-web asking for one
 * account. No provider is running here — Pact stands up a mock, checks that the
 * client this test describes is satisfied by the response it declares, and
 * writes pacts/invest-web-invest-api.json.
 *
 * Path and response shape come from openapi/openapi.yaml (HW #9):
 * `GET /accounts/{account_id}` → `#/components/schemas/Account`. Matchers
 * rather than literals for everything except the id, so a new row somewhere in
 * the database can never break the contract.
 */
const pact = new PactV3({
  consumer: 'invest-web',
  provider: 'invest-api',
  dir: resolve(__dirname, '../../pacts'),
});

describe('invest-web → invest-api contract', () => {
  it('fetches one account by id', async () => {
    pact
      .given(`account ${ACCOUNT_ID} exists`)
      .uponReceiving('a request for a single account')
      .withRequest({
        method: 'GET',
        path: `/accounts/${ACCOUNT_ID}`,
        headers: { Accept: 'application/json' },
      })
      .willRespondWith({
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: {
          id: uuid(ACCOUNT_ID),
          name: like('Cash UAH'),
          type: like('cash'),
          currency: like('UAH'),
          balance_cents: integer(350000),
          created_at: datetime("yyyy-MM-dd'T'HH:mm:ss.SSSX", '2026-01-01T00:00:00.000Z'),
        },
      });

    await pact.executeTest(async (mockServer) => {
      const res = await fetch(`${mockServer.url}/accounts/${ACCOUNT_ID}`, {
        headers: { Accept: 'application/json' },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { id: string; balance_cents: number };
      expect(body.id).toBe(ACCOUNT_ID);
      expect(typeof body.balance_cents).toBe('number');
    });
  });
});
