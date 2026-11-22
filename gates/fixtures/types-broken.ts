// HW #32 demo:gates, step "types", broken input: a typo in a field name.
// tsc --noEmit must reject it (TS2551), exactly as it would inside src/.
interface Account {
  balanceMinor: bigint;
}
export const total = (a: Account): bigint => a.balanceMinr;
