import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTestingEvidenceStorage1784390000000 implements MigrationInterface {
  name = 'CreateTestingEvidenceStorage1784390000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "testing_evidence_artifacts" ("id" varchar(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "tenant_id" varchar(128) NOT NULL, "project_id" varchar(128) NOT NULL, "campaign_id" varchar(128) NOT NULL, "execution_id" varchar(128) NOT NULL, "kind" varchar(40) NOT NULL, "media_type" varchar(128) NOT NULL, "byte_length" bigint NOT NULL, "sha256" varchar(64) NOT NULL, "captured_at" timestamptz NOT NULL, "sensitivity" varchar(16) NOT NULL, "redaction_state" varchar(16) NOT NULL, "redaction_version" varchar(64), "retention_class" varchar(32) NOT NULL, "retention_expires_at" timestamptz NOT NULL, "parent_artifact_id" varchar(26), "object_name" varchar(128) NOT NULL, "deletion_state" varchar(16) NOT NULL, "object_deleted_at" timestamptz, CONSTRAINT "pk_testing_evidence_artifacts" PRIMARY KEY ("id"), CONSTRAINT "uq_testing_evidence_object_name" UNIQUE ("object_name"), CONSTRAINT "chk_testing_evidence_sha256" CHECK ("sha256" ~ '^[a-f0-9]{64}$'), CONSTRAINT "chk_testing_evidence_deletion_state" CHECK ("deletion_state" IN ('available', 'deleted')))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_testing_evidence_tenant_id" ON "testing_evidence_artifacts" ("tenant_id", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_testing_evidence_tenant_retention" ON "testing_evidence_artifacts" ("tenant_id", "retention_expires_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_testing_evidence_tenant_execution" ON "testing_evidence_artifacts" ("tenant_id", "execution_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "testing_evidence_artifacts"`);
  }
}
