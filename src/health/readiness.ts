/**
 * Process-wide traffic switch. main.ts flips `draining` on SIGTERM, so the
 * readiness probe goes red BEFORE the socket closes (HW #28).
 */
export const readiness = { draining: false };
