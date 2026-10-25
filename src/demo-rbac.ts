import { runDemo, USERS } from './demo-auth-kit';

/**
 * HW #24 demo:rbac — authentication (401) and authorization (403) kept apart.
 *   role level:      POST /accounts is member-only; a viewer gets 403;
 *   ownership level: GET /accounts/{id} of someone else's account is 403;
 *   tampered:        the viewer's own token with role swapped to member and the
 *                    old signature kept. A server that jwt.decode()s instead of
 *                    verifying would answer 201 here.
 */
function forgeRole(token: string, role: string): string {
  const parts = token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  payload.role = role;
  parts[1] = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return parts.join('.');
}

void runDemo(
  {
    anon: [401],
    own: [200],
    foreign: [403],
    'role-denied': [403],
    'role-allowed': [200, 201],
    tampered: [401],
  },
  async (http) => {
    const r: Record<string, number> = {};
    const owner = (await http.login(USERS.owner)).body.access_token;
    const other = (await http.login(USERS.other)).body.access_token;
    const viewer = (await http.login(USERS.viewer)).body.access_token;
    const newAccount = { name: 'Demo RBAC cash', type: 'cash', currency: 'UAH', opening_balance_cents: 0 };

    const created = await http.call('POST', '/accounts', { token: owner, body: newAccount });
    r['role-allowed'] = created.status;
    const path = `/accounts/${created.body.id}`;

    r.anon = (await http.call('GET', path)).status;
    r.own = (await http.call('GET', path, { token: owner })).status;
    r.foreign = (await http.call('GET', path, { token: other })).status;
    r['role-denied'] = (await http.call('POST', '/accounts', { token: viewer, body: newAccount })).status;
    r.tampered = (await http.call('POST', '/accounts', { token: forgeRole(viewer, 'member'), body: newAccount }))
      .status;
    return r;
  },
);
