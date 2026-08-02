import { MigrationInterface, QueryRunner } from 'typeorm';

const UTC_COLUMNS = [
  {
    table: 'users',
    columns: ['created_at', 'updated_at', 'deleted_at', 'email_verified_at'],
  },
  {
    table: 'password_credentials',
    columns: ['created_at', 'updated_at', 'deleted_at'],
  },
  {
    table: 'authentication_sessions',
    columns: [
      'created_at',
      'updated_at',
      'deleted_at',
      'issued_at',
      'expires_at',
      'revoked_at',
    ],
  },
  {
    table: 'authentication_refresh_tokens',
    columns: [
      'created_at',
      'updated_at',
      'deleted_at',
      'expires_at',
      'rotated_at',
      'revoked_at',
    ],
  },
  {
    table: 'identity_one_time_tokens',
    columns: [
      'created_at',
      'updated_at',
      'deleted_at',
      'expires_at',
      'consumed_at',
      'revoked_at',
    ],
  },
  {
    table: 'authentication_login_throttles',
    columns: ['window_started_at', 'locked_until', 'updated_at'],
  },
  {
    table: 'idempotency_records',
    columns: ['created_at', 'updated_at', 'deleted_at'],
  },
  {
    table: 'testing_evidence_artifacts',
    columns: ['created_at', 'updated_at', 'deleted_at'],
  },
] as const;

export class ReconcileFoundationUtcTimestamps1784390100000 implements MigrationInterface {
  name = 'ReconcileFoundationUtcTimestamps1784390100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, columns } of UTC_COLUMNS) {
      await queryRunner.query(
        alterTimestampColumns(table, columns, 'timestamp with time zone'),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, columns } of [...UTC_COLUMNS].reverse()) {
      await queryRunner.query(
        alterTimestampColumns(table, columns, 'timestamp without time zone'),
      );
    }
  }
}

function alterTimestampColumns(
  table: string,
  columns: readonly string[],
  targetType: 'timestamp with time zone' | 'timestamp without time zone',
): string {
  // Existing timezone-less values were written as UTC instants by the API.
  const alterations = columns
    .map(
      (column) =>
        `ALTER COLUMN "${column}" TYPE ${targetType} USING "${column}" AT TIME ZONE 'UTC'`,
    )
    .join(', ');
  return `ALTER TABLE "${table}" ${alterations}`;
}
