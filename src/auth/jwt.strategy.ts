import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Env } from '@/config/env.schema';
import { problem } from '@/shared/problem.exception';
import { AuthUser, Role } from './auth.types';
import { JWT_AUDIENCE, JWT_ISSUER, TokensService } from './tokens.service';

interface AccessPayload {
  sub: string;
  role: Role;
  sid: string;
  jti: string;
  exp: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<Env, true>,
    jwt: JwtService,
    private readonly tokens: TokensService,
  ) {
    // kid → public key. One entry today; during an overlap rotation the previous
    // kid stays here until every token it signed has expired (README ## Auth).
    const keys = new Map([[config.get('JWT_KID', { infer: true }), config.get('JWT_PUBLIC_KEY', { infer: true })]]);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (_req: unknown, rawJwt: string, done: (err: unknown, key?: Buffer) => void) => {
        // Header only, to pick the key; nothing in it is trusted until the signature verifies.
        const kid: unknown = jwt.decode(rawJwt, { complete: true })?.header?.kid;
        const key = typeof kid === 'string' ? keys.get(kid) : undefined;
        done(key ? null : new Error('unknown kid'), key);
      },
      // The allowlist is the whole defence against algorithm confusion (RFC 8725
      // §3.1): `alg` comes from the attacker-controlled header otherwise.
      algorithms: ['ES256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  /** Signature and exp are already checked by passport-jwt; revocation is ours to check. */
  async validate(payload: AccessPayload): Promise<AuthUser> {
    if (await this.tokens.isRevoked(payload.jti)) {
      throw problem(HttpStatus.UNAUTHORIZED, 'token-revoked', 'access token was revoked');
    }
    return { id: payload.sub, role: payload.role, jti: payload.jti, sid: payload.sid, exp: payload.exp };
  }
}
