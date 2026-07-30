import { MigrationInterface, QueryRunner } from 'typeorm';

export class SecureAuthenticationSessions1784389500000 implements MigrationInterface {
  name = 'SecureAuthenticationSessions1784389500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth_accounts" RENAME TO "users"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "status" varchar(32) NOT NULL DEFAULT 'pending_verification', ADD "email_verified_at" timestamp, ADD "locale" varchar(35) NOT NULL DEFAULT 'en', ADD "timezone" varchar(64) NOT NULL DEFAULT 'UTC'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "ck_users_status" CHECK ("status" IN ('pending_verification', 'active', 'disabled'))`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "status" = 'active', "email_verified_at" = COALESCE("created_at", now())`,
    );
    await queryRunner.query(
      `CREATE TABLE "password_credentials" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "user_id" varchar(26) NOT NULL, "algorithm" varchar(32) NOT NULL, "password_hash" varchar(512) NOT NULL, "legacy_salt" varchar(64), CONSTRAINT "pk_password_credentials" PRIMARY KEY ("id"), CONSTRAINT "uq_password_credentials_user" UNIQUE ("user_id"), CONSTRAINT "ck_password_credentials_algorithm" CHECK ("algorithm" IN ('argon2id', 'legacy_scrypt')), CONSTRAINT "fk_password_credentials_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `INSERT INTO "password_credentials" ("id", "created_at", "updated_at", "deleted_at", "user_id", "algorithm", "password_hash", "legacy_salt") SELECT "id", "created_at", "updated_at", "deleted_at", "id", 'legacy_scrypt', "password_hash", "password_salt" FROM "users"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "password_salt", DROP COLUMN "password_hash", DROP COLUMN "refresh_version"`,
    );
    await queryRunner.query(
      `CREATE TABLE "authentication_sessions" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "principal_id" varchar(26) NOT NULL, "status" varchar(16) NOT NULL DEFAULT 'active', "rotation_family_id" varchar(26) NOT NULL, "issued_at" timestamp NOT NULL, "expires_at" timestamp NOT NULL, "revoked_at" timestamp, "revocation_reason" varchar(500), CONSTRAINT "pk_authentication_sessions" PRIMARY KEY ("id"), CONSTRAINT "ck_authentication_sessions_status" CHECK ("status" IN ('active', 'revoked', 'expired')), CONSTRAINT "fk_authentication_sessions_user" FOREIGN KEY ("principal_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_authentication_sessions_principal" ON "authentication_sessions" ("principal_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_authentication_sessions_family" ON "authentication_sessions" ("rotation_family_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "authentication_refresh_tokens" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "session_id" varchar(26) NOT NULL, "rotation_family_id" varchar(26) NOT NULL, "token_hash" char(64) NOT NULL, "expires_at" timestamp NOT NULL, "rotated_at" timestamp, "revoked_at" timestamp, CONSTRAINT "pk_authentication_refresh_tokens" PRIMARY KEY ("id"), CONSTRAINT "uq_authentication_refresh_tokens_hash" UNIQUE ("token_hash"), CONSTRAINT "fk_authentication_refresh_tokens_session" FOREIGN KEY ("session_id") REFERENCES "authentication_sessions"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_authentication_refresh_tokens_session" ON "authentication_refresh_tokens" ("session_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_authentication_refresh_tokens_family" ON "authentication_refresh_tokens" ("rotation_family_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "identity_one_time_tokens" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "user_id" varchar(26) NOT NULL, "purpose" varchar(32) NOT NULL, "token_hash" char(64) NOT NULL, "expires_at" timestamp NOT NULL, "consumed_at" timestamp, "revoked_at" timestamp, CONSTRAINT "pk_identity_one_time_tokens" PRIMARY KEY ("id"), CONSTRAINT "uq_identity_one_time_tokens_hash" UNIQUE ("token_hash"), CONSTRAINT "ck_identity_one_time_tokens_purpose" CHECK ("purpose" IN ('email_verification', 'password_recovery')), CONSTRAINT "fk_identity_one_time_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_identity_one_time_tokens_user_purpose" ON "identity_one_time_tokens" ("user_id", "purpose")`,
    );
    await queryRunner.query(
      `CREATE TABLE "authentication_login_throttles" ("fingerprint" char(64) NOT NULL, "attempt_count" integer NOT NULL DEFAULT 0, "window_started_at" timestamp NOT NULL, "locked_until" timestamp, "updated_at" timestamp NOT NULL, CONSTRAINT "pk_authentication_login_throttles" PRIMARY KEY ("fingerprint"), CONSTRAINT "ck_authentication_login_throttle_attempts" CHECK ("attempt_count" >= 0))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM "password_credentials" WHERE "algorithm" <> 'legacy_scrypt') THEN RAISE EXCEPTION 'Cannot restore the legacy auth schema after Argon2id credentials have been created'; END IF; END $$`,
    );
    await queryRunner.query(`DROP TABLE "authentication_login_throttles"`);
    await queryRunner.query(`DROP TABLE "identity_one_time_tokens"`);
    await queryRunner.query(`DROP TABLE "authentication_refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "authentication_sessions"`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD "password_salt" varchar(64), ADD "password_hash" varchar(512), ADD "refresh_version" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE "users" SET "password_salt" = COALESCE("password_credentials"."legacy_salt", ''), "password_hash" = "password_credentials"."password_hash" FROM "password_credentials" WHERE "password_credentials"."user_id" = "users"."id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_salt" SET NOT NULL, ALTER COLUMN "password_hash" TYPE varchar(128), ALTER COLUMN "password_hash" SET NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "password_credentials"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "ck_users_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "status", DROP COLUMN "email_verified_at", DROP COLUMN "locale", DROP COLUMN "timezone"`,
    );
    await queryRunner.query(`ALTER TABLE "users" RENAME TO "auth_accounts"`);
  }
}
