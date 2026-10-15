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

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: 'Bearer';
  expires_in: number;
}
