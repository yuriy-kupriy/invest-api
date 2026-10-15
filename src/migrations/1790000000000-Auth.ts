import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * HW #24: login credentials, refresh-token families and the access-token denylist.
 *
 * users.password_hash is nullable on purpose: seeded users have no password and
 * simply cannot log in. users.role is the source of truth for authorization;
 * the `role` claim in an access token is only a cache of it until `exp`.
 *
 * refresh_tokens stores HMAC(pepper, token), never the token itself, so a dump
 * of this table is not a dump of live sessions.
 *   family_id  — every token descended from one login; the link that lets a
 *                detected replay revoke the whole chain (RFC 9700 §4.14.2);
 *   used_at    — set when the token is rotated; presenting it again is reuse;
 *   revoked_at — set on logout or on reuse detection, for the whole family.
 * The unique index on token_hash is the lookup path of every refresh; the
 * family_id index is the path of every revocation.
 *
 * revoked_access_tokens is the denylist for jti of logged-out access tokens.
 * It lives in the same database as refresh_tokens so logout is one COMMIT, not
 * a dual write. expires_at = the token's own exp: past it the row is useless
 * (the signature check already rejects the token) and logout deletes it.
 */
export class Auth1790000000000 implements MigrationInterface {
  name = 'Auth1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" text`);
    await queryRunner.query(`ALTER TABLE "users" ADD "role" text NOT NULL DEFAULT 'member'`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "users_role_enum" CHECK (role IN ('viewer', 'member'))`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (` +
        `"id" uuid NOT NULL DEFAULT gen_random_uuid(), ` +
        `"user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE, ` +
        `"family_id" uuid NOT NULL, ` +
        `"token_hash" text NOT NULL, ` +
        `"used_at" TIMESTAMP(3) WITH TIME ZONE, ` +
        `"revoked_at" TIMESTAMP(3) WITH TIME ZONE, ` +
        `"expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, ` +
        `"created_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "refresh_tokens_pk" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "refresh_tokens_token_hash_uk" ON "refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(`CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" ("family_id")`);

    await queryRunner.query(
      `CREATE TABLE "revoked_access_tokens" (` +
        `"jti" uuid NOT NULL, ` +
        `"expires_at" TIMESTAMP(3) WITH TIME ZONE NOT NULL, ` +
        `CONSTRAINT "revoked_access_tokens_pk" PRIMARY KEY ("jti"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "revoked_access_tokens"`);
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_role_enum"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
  }
}
