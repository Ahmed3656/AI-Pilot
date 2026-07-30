import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditRecords1784304200000 implements MigrationInterface {
  name = 'CreateAuditRecords1784304200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "audit_records" ("id" varchar(26) NOT NULL, "organization_id" varchar(128) NOT NULL, "actor_type" varchar(32) NOT NULL, "actor_id" varchar(128) NOT NULL, "action" varchar(128) NOT NULL, "target_type" varchar(128) NOT NULL, "target_id" varchar(128) NOT NULL, "occurred_at" timestamptz NOT NULL, "request_id" varchar(64) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "policy_version" varchar(128), "statement_version" varchar(128), "outcome" varchar(16) NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(), CONSTRAINT "pk_audit_records" PRIMARY KEY ("id"), CONSTRAINT "chk_audit_records_actor_type" CHECK ("actor_type" IN ('principal', 'service', 'system')), CONSTRAINT "chk_audit_records_outcome" CHECK ("outcome" IN ('succeeded', 'failed', 'denied')))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_audit_records_organization_occurred_id" ON "audit_records" ("organization_id", "occurred_at" DESC, "id" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_records"`);
  }
}
