import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderedEventInfrastructure1784389500000 implements MigrationInterface {
  name = 'CreateOrderedEventInfrastructure1784389500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "event_stream_sequences" (
        "stream_id" varchar(128) NOT NULL,
        "last_sequence" bigint NOT NULL DEFAULT 0,
        "retained_from" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "pk_event_stream_sequences" PRIMARY KEY ("stream_id"),
        CONSTRAINT "ck_event_stream_sequences_nonnegative"
          CHECK ("last_sequence" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "ordered_events" (
        "event_id" varchar(128) NOT NULL,
        "stream_id" varchar(128) NOT NULL,
        "sequence" bigint NOT NULL,
        "event_type" varchar(120) NOT NULL,
        "schema_version" varchar(40) NOT NULL,
        "actor_type" varchar(80),
        "safe_payload" jsonb NOT NULL,
        "occurred_at" timestamptz NOT NULL,
        "persisted_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "correlation_id" varchar(128),
        "content_fingerprint" char(64) NOT NULL,
        "retention_class" varchar(40) NOT NULL,
        "retain_until" timestamptz,
        CONSTRAINT "pk_ordered_events" PRIMARY KEY ("event_id"),
        CONSTRAINT "uq_ordered_events_stream_sequence"
          UNIQUE ("stream_id", "sequence"),
        CONSTRAINT "ck_ordered_events_positive_sequence"
          CHECK ("sequence" > 0),
        CONSTRAINT "fk_ordered_events_stream"
          FOREIGN KEY ("stream_id")
          REFERENCES "event_stream_sequences"("stream_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ordered_events_retention"
      ON "ordered_events" ("retain_until")
    `);
    await queryRunner.query(`
      CREATE TABLE "pruned_event_cursors" (
        "event_id" varchar(128) NOT NULL,
        "stream_id" varchar(128) NOT NULL,
        "sequence" bigint NOT NULL,
        "content_fingerprint" char(64) NOT NULL,
        "pruned_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "pk_pruned_event_cursors" PRIMARY KEY ("event_id"),
        CONSTRAINT "uq_pruned_event_cursors_stream_sequence"
          UNIQUE ("stream_id", "sequence"),
        CONSTRAINT "fk_pruned_event_cursors_stream"
          FOREIGN KEY ("stream_id")
          REFERENCES "event_stream_sequences"("stream_id")
          ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE FUNCTION "reject_ordered_event_update"()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $$
      BEGIN
        RAISE EXCEPTION 'ordered events are immutable'
          USING ERRCODE = '55000';
      END;
      $$
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_ordered_events_immutable"
      BEFORE UPDATE ON "ordered_events"
      FOR EACH ROW
      EXECUTE FUNCTION "reject_ordered_event_update"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER "trg_ordered_events_immutable" ON "ordered_events"',
    );
    await queryRunner.query('DROP FUNCTION "reject_ordered_event_update"');
    await queryRunner.query('DROP TABLE "pruned_event_cursors"');
    await queryRunner.query('DROP INDEX "idx_ordered_events_retention"');
    await queryRunner.query('DROP TABLE "ordered_events"');
    await queryRunner.query('DROP TABLE "event_stream_sequences"');
  }
}
