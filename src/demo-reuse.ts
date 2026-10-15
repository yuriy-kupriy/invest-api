import { runDemo, USERS } from './demo-auth-kit';

/**
 * HW #24 demo:reuse — the heart of the homework. r1 is spent once (legit
 * rotation to r2), then presented again: that replay revokes the whole family,
 * so r2 — the token the honest client holds — dies too. r1-reuse=401 alone is
 * what any rotation gives; r2-after-reuse=401 is what only reuse DETECTION gives.
 */
void runDemo(
  {
    login: [200],
    'r1-refresh': [200],
    'r1-reuse': [401],
    'r2-after-reuse': [401],
  },
  async (http) => {
    const r: Record<string, number> = {};

    const login = await http.login(USERS.owner);
    r.login = login.status;
    const r1: string = login.body.refresh_token;

    const rotated = await http.refresh(r1);
    r['r1-refresh'] = rotated.status;
    const r2: string = rotated.body.refresh_token;

    r['r1-reuse'] = (await http.refresh(r1)).status;
    r['r2-after-reuse'] = (await http.refresh(r2)).status;
    return r;
  },
);
