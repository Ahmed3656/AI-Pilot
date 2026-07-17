import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuthAccounts1784304100000 implements MigrationInterface {
  name = 'CreateAuthAccounts1784304100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "auth_accounts" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "email" varchar(320) NOT NULL, "display_name" varchar(120) NOT NULL, "password_salt" varchar(64) NOT NULL, "password_hash" varchar(128) NOT NULL, "refresh_version" integer NOT NULL DEFAULT 0, CONSTRAINT "pk_auth_accounts" PRIMARY KEY ("id"), CONSTRAINT "uq_auth_accounts_email" UNIQUE ("email"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "auth_accounts"`);
  }
}
