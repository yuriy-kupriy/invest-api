import { HttpStatus, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { problem } from '@/shared/problem.exception';
import { AccessPayload, AuthUser, toAuthUser } from './auth.types';
import { JWT_AUDIENCE, JWT_ISSUER, TokensService } from './tokens.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly tokens: TokensService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (_req: unknown, rawJwt: string, done: (err: unknown, key?: Buffer) => void) => {
        const key = tokens.keyFor(rawJwt);
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
    return toAuthUser(payload);
  }
}
