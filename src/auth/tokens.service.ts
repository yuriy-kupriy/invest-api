import { createHash, createHmac, createPublicKey, randomBytes, randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Env } from '@/config/env.schema';
import { Role } from './auth.types';

export const JWT_ISSUER = 'invest-api';
export const JWT_AUDIENCE = 'invest-api';
/** Access lifetime: short, because a stolen access token is only revocable through the denylist. */
export const ACCESS_TTL_SECONDS = 10 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

/** sha256 of the DER SPKI — what the logs and README show instead of the key. */
function keyFingerprint(publicKeyPem: Buffer): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly pepper: string;

  constructor(
    private readonly jwt: JwtService,
    @InjectDataSource() private readonly dataSource: DataSource,
    config: ConfigService<Env, true>,
  ) {
    this.pepper = config.get('REFRESH_TOKEN_PEPPER', { infer: true });
    this.logger.log(
      `jwt kid=${config.get('JWT_KID', { infer: true })} key=${keyFingerprint(config.get('JWT_PUBLIC_KEY', { infer: true }))}`,
    );
  }

  /** ES256, kid/iss/aud/exp from JwtModule's signOptions; jti makes the token denylistable. */
  signAccess(sub: string, role: Role, sid: string): Promise<string> {
    return this.jwt.signAsync({ role, sid }, { subject: sub, jwtid: randomUUID() });
  }

  /** Opaque, not a JWT: it means nothing outside our table. */
  newRefresh(): string {
    return randomBytes(32).toString('base64url');
  }

  /** HMAC with the vault pepper: a leaked table alone cannot be matched against anything. */
  hashRefresh(token: string): string {
    return createHmac('sha256', this.pepper).update(token).digest('hex');
  }

  async isRevoked(jti: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM revoked_access_tokens WHERE jti = $1 AND expires_at > now()`,
      [jti],
    );
    return rows.length > 0;
  }
}
