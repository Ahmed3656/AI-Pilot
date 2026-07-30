import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateIdempotencyRecords1784389500000 implements MigrationInterface {
  name = 'CreateIdempotencyRecords1784389500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "idempotency_records" ("id" varchar(26) NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), "deleted_at" timestamp, "organization_id" varchar(128) NOT NULL, "principal_id" varchar(128) NOT NULL, "method" varchar(8) NOT NULL, "canonical_path" varchar(512) NOT NULL, "idempotency_key" varchar(128) NOT NULL, "request_fingerprint" varchar(64) NOT NULL, "response_status" smallint NOT NULL, "response_body" jsonb NOT NULL, "expires_at" timestamptz NOT NULL, CONSTRAINT "pk_idempotency_records" PRIMARY KEY ("id"), CONSTRAINT "uq_idempotency_record_scope" UNIQUE ("organization_id", "principal_id", "method", "canonical_path", "idempotency_key"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_idempotency_record_expires_at" ON "idempotency_records" ("expires_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "idempotency_records"`);
  }
}
