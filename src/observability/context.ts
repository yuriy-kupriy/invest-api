import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * HW #29. Per-request context that is NOT the correlator: the correlator is the
 * active OTel span's trace_id (see logger.ts). Mutable on purpose — the JWT
 * strategy fills userId into the store created by the HTTP middleware.
 */
export interface RequestContext {
  tenant: string;
  idempotencyKey?: string;
  userId?: string;
  /** Demo-only fault switch, see assertNoInjectedFault(). */
  fault: boolean;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/**
 * shortcut: deterministic 5xx for the HW #29 demos — `x-fault: 1` only counts
 * when FAULT_INJECTION=1 (default 0). Replace with a real chaos tool if one
 * ever lands; it must never be on in production.
 */
export function assertNoInjectedFault(): void {
  if (requestContext.getStore()?.fault) {
    throw new Error('injected fault (x-fault header, FAULT_INJECTION=1)');
  }
}
