import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShoppingControlPlane1784299904203 implements MigrationInterface {
  name = 'CreateShoppingControlPlane1784299904203';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."shopping_run_category_enum" AS ENUM('retail', 'food', 'cinema')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shopping_run_state_enum" AS ENUM('clarifying', 'discovering', 'awaiting_domain_approval', 'comparing', 'awaiting_address_consent', 'awaiting_seat_hold_approval', 'coupon_testing', 'ready_for_handoff', 'user_takeover', 'completed', 'paused', 'failed', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_runs" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "category" "public"."shopping_run_category_enum" NOT NULL, "market" character varying(2) NOT NULL DEFAULT 'EG', "currency" character varying(3) NOT NULL DEFAULT 'EGP', "state" "public"."shopping_run_state_enum" NOT NULL, "resume_state" "public"."shopping_run_state_enum", "query" text NOT NULL, "ai_run_id" character varying(128), "failure_code" character varying(80), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "chk_shopping_runs_currency_egp" CHECK ("currency" = 'EGP'), CONSTRAINT "chk_shopping_runs_market_eg" CHECK ("market" = 'EG'), CONSTRAINT "PK_8c40216734926d67ef273ee59cf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4848b6c684e6c526573f0db403" ON "shopping_runs" ("state") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_run_events" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "event_id" character varying(128) NOT NULL, "type" character varying(80) NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}'::jsonb, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "uq_shopping_run_events_run_event" UNIQUE ("run_id", "event_id"), CONSTRAINT "PK_bf7618fdcbc2c69ae6a02b38b9b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3261c5beed88e1767e6f93c7a2" ON "shopping_run_events" ("run_id", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_evidence_artifacts" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "kind" character varying(40) NOT NULL, "uri" text NOT NULL, "sha256" character varying(64) NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, CONSTRAINT "PK_4c7c71d31b54c756554a51757fd" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1eb83e2674a2c9a255c2440167" ON "shopping_evidence_artifacts" ("run_id", "kind") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_coupon_attempts" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "merchant" character varying(120) NOT NULL, "coupon_code" character varying(80) NOT NULL, "status" character varying(40) NOT NULL, "before_total" numeric(12,2) NOT NULL, "after_total" numeric(12,2), "evidence_ids" jsonb NOT NULL DEFAULT '[]'::jsonb, CONSTRAINT "PK_cf41a637b994c71957e4df8cec1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d5f83000fb08c8ba620062ca02" ON "shopping_coupon_attempts" ("run_id", "merchant") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shopping_approval_type_enum" AS ENUM('domain_access', 'address_share', 'seat_hold')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_run_approvals" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "type" "public"."shopping_approval_type_enum" NOT NULL, "recipient_domains" jsonb NOT NULL DEFAULT '[]'::jsonb, "approved_at" TIMESTAMP WITH TIME ZONE NOT NULL, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, CONSTRAINT "PK_1047896a4737e8c334647abfe82" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0f85fc6949c7ca4e1c03b6d67a" ON "shopping_run_approvals" ("run_id", "type") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."shopping_offer_category_enum" AS ENUM('retail', 'food', 'cinema')`,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_normalized_offers" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "merchant" character varying(120) NOT NULL, "category" "public"."shopping_offer_category_enum" NOT NULL, "title" text NOT NULL, "source_url" text NOT NULL, "currency" character varying(3) NOT NULL DEFAULT 'EGP', "base_price" numeric(12,2) NOT NULL, "delivery_fee" numeric(12,2), "service_fee" numeric(12,2), "tax" numeric(12,2), "discount" numeric(12,2), "final_total" numeric(12,2) NOT NULL, "coupon_code" character varying(80), "availability" character varying(80) NOT NULL, "observed_at" TIMESTAMP WITH TIME ZONE NOT NULL, "evidence_ids" jsonb NOT NULL DEFAULT '[]'::jsonb, "match_confidence" real NOT NULL, "incomplete_reason" text, "details" jsonb NOT NULL DEFAULT '{}'::jsonb, CONSTRAINT "chk_shopping_normalized_offers_currency_egp" CHECK ("currency" = 'EGP'), CONSTRAINT "PK_535861e528016e9ea2db81cf998" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_be51bf449a8fb3e1628f71dae7" ON "shopping_normalized_offers" ("run_id", "final_total") `,
    );
    await queryRunner.query(
      `CREATE TABLE "shopping_merchant_attempts" ("id" character varying(26) NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "deleted_at" TIMESTAMP, "run_id" character varying(26) NOT NULL, "merchant" character varying(120) NOT NULL, "merchant_domain" character varying(255) NOT NULL, "status" character varying(40) NOT NULL, "error_code" character varying(80), "started_at" TIMESTAMP WITH TIME ZONE NOT NULL, "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_95ff5fac48e8c61058428fb24f4" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_969b8826b03d495635860bf869" ON "shopping_merchant_attempts" ("run_id", "merchant_domain") `,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_events" ADD CONSTRAINT "FK_adcc11309934228fc601c991b5f" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" ADD CONSTRAINT "FK_3635119eb074a8eec7391247049" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_coupon_attempts" ADD CONSTRAINT "FK_e9ea5a88408516ce00c8af181e8" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" ADD CONSTRAINT "FK_9bbc3566845b017f9a694b2eb33" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" ADD CONSTRAINT "FK_432b75b0a9079bccd64c9d54793" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_merchant_attempts" ADD CONSTRAINT "FK_4b50735693613287aa501091a81" FOREIGN KEY ("run_id") REFERENCES "shopping_runs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_merchant_attempts" DROP CONSTRAINT "FK_4b50735693613287aa501091a81"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" DROP CONSTRAINT "FK_432b75b0a9079bccd64c9d54793"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" DROP CONSTRAINT "FK_9bbc3566845b017f9a694b2eb33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_coupon_attempts" DROP CONSTRAINT "FK_e9ea5a88408516ce00c8af181e8"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" DROP CONSTRAINT "FK_3635119eb074a8eec7391247049"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_events" DROP CONSTRAINT "FK_adcc11309934228fc601c991b5f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_969b8826b03d495635860bf869"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_merchant_attempts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_be51bf449a8fb3e1628f71dae7"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_normalized_offers"`);
    await queryRunner.query(
      `DROP TYPE "public"."shopping_offer_category_enum"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0f85fc6949c7ca4e1c03b6d67a"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_run_approvals"`);
    await queryRunner.query(`DROP TYPE "public"."shopping_approval_type_enum"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d5f83000fb08c8ba620062ca02"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_coupon_attempts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1eb83e2674a2c9a255c2440167"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_evidence_artifacts"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3261c5beed88e1767e6f93c7a2"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_run_events"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4848b6c684e6c526573f0db403"`,
    );
    await queryRunner.query(`DROP TABLE "shopping_runs"`);
    await queryRunner.query(`DROP TYPE "public"."shopping_run_state_enum"`);
    await queryRunner.query(`DROP TYPE "public"."shopping_run_category_enum"`);
  }
}
