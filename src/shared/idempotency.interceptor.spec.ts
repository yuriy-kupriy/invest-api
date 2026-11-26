import { evictIdempotencyKeys, idempotencyStore } from './idempotency.interceptor';

describe('evictIdempotencyKeys', () => {
  afterEach(() => idempotencyStore.clear());

  it('drops expired keys from the front and keeps live ones', () => {
    idempotencyStore.set('a', { state: 'in-flight', fingerprint: 'x', expiresAt: 100 });
    idempotencyStore.set('b', { state: 'in-flight', fingerprint: 'x', expiresAt: 200 });
    idempotencyStore.set('c', { state: 'in-flight', fingerprint: 'x', expiresAt: 300 });

    evictIdempotencyKeys(250);

    expect([...idempotencyStore.keys()]).toEqual(['c']);
  });
});
