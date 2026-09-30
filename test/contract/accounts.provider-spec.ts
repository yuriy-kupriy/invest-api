import { execSync } from 'node:child_process';
import { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Verifier, VerifierOptions } from '@pact-foundation/pact';
import { DataSource } from 'typeorm';
import { createApp } from '@/create-app';
import { connect, resetDb } from '../testkit/db';

const PACT_FILE = resolve(__dirname, '../../pacts/invest-web-invest-api.json');

/** The version the broker records a verification against, and the one `can-i-deploy` tags. */
export function providerVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return process.env.npm_package_version ?? '0.0.0';
  }
}

/**
 * Where the contract comes from. With PACT_BROKER_URL set this is the CI path:
 * pull the latest consumer contract from the broker and publish the result back,
 * which is what `can-i-deploy` later reads. Without it, verify the committed
 * pacts/*.json — so `npm run verify:provider` works on a fresh clone with
 * nothing but Docker running.
 *
 * The broker address and token are read from the environment only: locally they
 * arrive through scripts/with-secrets.sh, in CI through GitHub secrets.
 */
function contractSource(): Partial<VerifierOptions> {
  const pactBrokerUrl = process.env.PACT_BROKER_URL;
  if (!pactBrokerUrl) {
    return { pactUrls: [PACT_FILE] };
  }
  return {
    pactBrokerUrl,
    // Spread, not a plain key: the verifier rejects an explicit `undefined`,
    // and the local compose broker runs without auth.
    ...(process.env.PACT_BROKER_TOKEN ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN } : {}),
    consumerVersionSelectors: [{ latest: true }],
    publishVerificationResult: true,
  };
}

describe('invest-api provider verification', () => {
  let app: INestApplication;
  let ds: DataSource;
  let port: number;

  beforeAll(async () => {
    ds = await connect();
    // The real application — same createApp() main.ts calls, including the
    // OpenAPI request/response validator. A contract that passes here passes
    // against production's pipeline, not a stub of it.
    app = await createApp({ logger: false });
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    await ds.destroy();
  });

  it('honours every interaction in the contract', async () => {
    // verifyProvider() rejects on any mismatched interaction, so resolving at
    // all is the assertion. What it resolves WITH is an internal Pact string
    // ("finished: 0" today) that is not part of its API — pinning it would
    // break on a Pact upgrade without anything about the contract changing.
    const verification = new Verifier({
      provider: 'invest-api',
      providerBaseUrl: `http://127.0.0.1:${port}`,
      providerVersion: providerVersion(),
      ...contractSource(),
      stateHandlers: {
        // Idempotent on purpose: the verifier may replay a state any number of
        // times in one run, and re-seeding must not fail on the second pass.
        'account 11111111-1111-4111-8111-111111111111 exists': async () => {
          await resetDb(ds);
        },
      },
    } as VerifierOptions).verifyProvider();

    await expect(verification).resolves.toBeDefined();
  });
});
