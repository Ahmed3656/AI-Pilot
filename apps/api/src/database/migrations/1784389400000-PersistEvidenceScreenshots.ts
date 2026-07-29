import { MigrationInterface, QueryRunner } from 'typeorm';

export class PersistEvidenceScreenshots1784389400000 implements MigrationInterface {
  name = 'PersistEvidenceScreenshots1784389400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" ADD "content_type" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" ADD "content" bytea`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" DROP COLUMN "content"`,
    );
    await queryRunner.query(
      `ALTER TABLE "shopping_evidence_artifacts" DROP COLUMN "content_type"`,
    );
  }
}
