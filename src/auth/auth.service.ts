import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { problem } from '@/shared/problem.exception';
import { AuthUser, Role, TokenPair } from './auth.types';
import { verifyPassword } from './password';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, TokensService } from './tokens.service';

export type LoginUser = Pick<AuthUser, 'id' | 'role'>;

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  used: boolean;
  dead: boolean;
}

type RefreshOutcome = { kind: 'ok'; pair: TokenPair } | { kind: 'invalid' } | { kind: 'reuse'; row: RefreshRow };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tokens: TokensService,
  ) {}

  async validateUser(email: string, password: string): Promise<LoginUser | null> {
    const [user]: { id: string; role: Role; password_hash: string | null }[] = await this.dataSource.query(
      `SELECT id, role, password_hash FROM users WHERE email = $1`,
      [email],
    );
    // verifyPassword runs scrypt even for an unknown email — same cost either way.
    const ok = await verifyPassword(password, user?.password_hash ?? null);
    return ok && user ? { id: user.id, role: user.role } : null;
  }

  /** A login starts a new refresh family. */
  login(user: LoginUser): Promise<TokenPair> {
    return this.issue(this.dataSource.manager, user, randomUUID());
  }

  /**
   * Rotation with reuse detection (RFC 9700 §4.14.2). Every refresh marks the
   * presented token used and issues a successor in the same family, in one
   * COMMIT. A token that was already used is a replay: either the thief or the
   * honest client is holding a stale copy, and we cannot tell which — so the
   * whole family dies and both have to log in again.
   *
   * FOR UPDATE serialises two concurrent refreshes of the same token: the second
   * one sees used_at and is treated as reuse. That is the chosen policy — clients
   * must serialise their own refreshes (README ## Auth), there is no grace window.
   */
  async refresh(token: string): Promise<TokenPair> {
    const outcome = await this.dataSource.transaction(async (manager): Promise<RefreshOutcome> => {
      const [row]: RefreshRow[] = await manager.query(
        `SELECT id, user_id, family_id, used_at IS NOT NULL AS used,
                revoked_at IS NOT NULL OR expires_at <= now() AS dead
           FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
        [this.tokens.hashRefresh(token)],
      );
      if (!row || row.dead) {
        return { kind: 'invalid' };
      }
      if (row.used) {
        await this.revokeFamily(manager, row.family_id);
        return { kind: 'reuse', row };
      }

      await manager.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [row.id]);
      // The role is re-read here, not copied from the old token: a refresh is
      // where a demotion catches up with the session.
      const [user]: LoginUser[] = await manager.query(`SELECT id, role FROM users WHERE id = $1`, [row.user_id]);
      return { kind: 'ok', pair: await this.issue(manager, user, row.family_id) };
    });

    // Thrown only after the transaction: throwing inside it would roll back the
    // family revocation that is the whole point of detecting the replay.
    if (outcome.kind === 'reuse') {
      this.logger.warn(
        `refresh token reuse detected — family revoked family_id=${outcome.row.family_id} user_id=${outcome.row.user_id}`,
      );
      throw problem(HttpStatus.UNAUTHORIZED, 'refresh-reuse-detected', 'refresh token reuse detected; the session was revoked');
    }
    if (outcome.kind === 'invalid') {
      throw problem(HttpStatus.UNAUTHORIZED, 'refresh-invalid', 'refresh token is invalid, expired or revoked');
    }
    return outcome.pair;
  }

  /**
   * Logout is two acts because the two tokens are two kinds of thing: refresh is
   * a row, so marking the family revoked kills it; access is self-contained and
   * valid until exp, so only a denylist entry for its jti stops it. Both land in
   * the same database in one COMMIT — no dual write.
   */
  async logout(user: AuthUser): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.revokeFamily(manager, user.sid);
      await manager.query(
        `INSERT INTO revoked_access_tokens (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING`,
        [user.jti, user.exp],
      );
      // The denylist's TTL: an entry past its token's exp guards nothing.
      await manager.query(`DELETE FROM revoked_access_tokens WHERE expires_at <= now()`);
    });
    this.logger.log(`logout family_id=${user.sid} jti=${user.jti}`);
  }

  private async revokeFamily(manager: EntityManager, familyId: string): Promise<void> {
    await manager.query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId],
    );
  }

  private async issue(manager: EntityManager, user: LoginUser, familyId: string): Promise<TokenPair> {
    const refresh = this.tokens.newRefresh();
    await manager.query(
      `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))`,
      [user.id, familyId, this.tokens.hashRefresh(refresh), REFRESH_TTL_SECONDS],
    );
    return {
      access_token: await this.tokens.signAccess(user.id, user.role, familyId),
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
    };
  }
}
