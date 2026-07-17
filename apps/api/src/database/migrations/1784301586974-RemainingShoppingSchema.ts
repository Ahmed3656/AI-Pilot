import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemainingShoppingSchema1784301586974 implements MigrationInterface {
  name = 'RemainingShoppingSchema1784301586974';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_run_events" ALTER COLUMN "payload" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" ALTER COLUMN "recipient_domains" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" ALTER COLUMN "evidence_ids" SET DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" ALTER COLUMN "details" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" ALTER COLUMN "metadata" SET DEFAULT '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_coupon_attempts" ALTER COLUMN "evidence_ids" SET DEFAULT '[]'::jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_coupon_attempts" ALTER COLUMN "evidence_ids" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" ALTER COLUMN "metadata" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" ALTER COLUMN "details" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_normalized_offers" ALTER COLUMN "evidence_ids" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" ALTER COLUMN "metadata" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_approvals" ALTER COLUMN "recipient_domains" SET DEFAULT '[]'`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_run_events" ALTER COLUMN "payload" SET DEFAULT '{}'`,
    );
  }
}
