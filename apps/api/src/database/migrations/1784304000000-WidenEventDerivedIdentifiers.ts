import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenEventDerivedIdentifiers1784304000000 implements MigrationInterface {
  name = 'WidenEventDerivedIdentifiers1784304000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'shopping_merchant_attempts',
      'shopping_normalized_offers',
      'shopping_coupon_attempts',
      'shopping_evidence_artifacts',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "id" TYPE varchar(128)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'shopping_merchant_attempts',
      'shopping_normalized_offers',
      'shopping_coupon_attempts',
      'shopping_evidence_artifacts',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "id" TYPE varchar(26)`,
      );
    }
  }
}
