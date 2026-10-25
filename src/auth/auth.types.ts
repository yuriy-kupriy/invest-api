export const ROLES = ['viewer', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** What JwtStrategy.validate puts on `req.user` — the verified claims of the access token. */
export interface AuthUser {
  id: string;
  role: Role;
  /** Access token id: the denylist key on logout. */
  jti: string;
  /** Refresh-token family this access token was issued with; logout revokes it. */
  sid: string;
  /** Token expiry, epoch seconds: the denylist entry lives exactly this long. */
  exp: number;
}

/** Claims of an access token, as signed by TokensService.signAccess. */
export interface AccessPayload {
  sub: string;
  role: Role;
  sid: string;
  jti: string;
  exp: number;
}

export function toAuthUser(payload: AccessPayload): AuthUser {
  return { id: payload.sub, role: payload.role, jti: payload.jti, sid: payload.sid, exp: payload.exp };
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
