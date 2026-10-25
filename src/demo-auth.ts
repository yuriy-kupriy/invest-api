import { runDemo, USERS } from './demo-auth-kit';

/**
 * HW #24 demo:auth — logout kills BOTH tokens. after-logout=401 is the denylist
 * at work: the access token is still validly signed and not expired, only its
 * jti in revoked_access_tokens stops it. refresh-after-logout=401 is the
 * revoked family.
 */
void runDemo(
  {
    login: [200],
    'no-token': [401],
    'with-token': [200],
    refresh: [200],
    logout: [200, 204],
    'after-logout': [401],
    'refresh-after-logout': [401],
  },
  async (http) => {
    const r: Record<string, number> = {};

    const login = await http.login(USERS.owner);
    r.login = login.status;
    r['no-token'] = (await http.call('GET', '/accounts')).status;
    r['with-token'] = (await http.call('GET', '/accounts', { token: login.body.access_token })).status;

    const refreshed = await http.refresh(login.body.refresh_token);
    r.refresh = refreshed.status;
    const { access_token, refresh_token } = refreshed.body;

    r.logout = (await http.call('POST', '/auth/logout', { token: access_token })).status;
    r['after-logout'] = (await http.call('GET', '/accounts', { token: access_token })).status;
    r['refresh-after-logout'] = (await http.refresh(refresh_token)).status;
    return r;
  },
);
