import { DataSource, MigrationExecutor, QueryRunner } from 'typeorm';
import dataSource from './data-source';
import { PLATFORM_MIGRATIONS } from './migration-manifest';
import { CreateOrderedEventInfrastructure1784389500000 } from './migrations/1784389500000-CreateOrderedEventInfrastructure';

const EXPECTED_MIGRATION_NAMES = [
  'CreateShoppingControlPlane1784299904203',
  'RemainingShoppingSchema1784301586974',
  'CanonicalMvpContract1784303000000',
  'WidenEventDerivedIdentifiers1784304000000',
  'CreateAuthAccounts1784304100000',
  'CreateAuditRecords1784304200000',
  'PersistEvidenceScreenshots1784389400000',
  'CreateIdempotencyRecords1784389500000',
  'CreateOrderedEventInfrastructure1784389500000',
  'SecureAuthenticationSessions1784389500000',
  'CreateTestingEvidenceStorage1784390000000',
  'ReconcileFoundationUtcTimestamps1784390100000',
];

describe('migration manifest', () => {
  it('uses only an explicit class manifest and preserves merged identities', () => {
    const configured = dataSource.options.migrations;
    expect(Array.isArray(configured)).toBe(true);
    expect(
      (configured as unknown[]).every((item) => typeof item === 'function'),
    ).toBe(true);

    const names = PLATFORM_MIGRATIONS.map((Migration) => new Migration().name);
    expect(names).toEqual(EXPECTED_MIGRATION_NAMES);
    expect(new Set(names).size).toBe(names.length);
  });

  it('resolves timestamp ties in manifest order', async () => {
    const source = new DataSource({
      type: 'postgres',
      database: 'migration-order-test',
      entities: [],
      migrations: [],
    });
    source.migrations.push(
      ...PLATFORM_MIGRATIONS.map((Migration) => new Migration()),
    );

    const resolved = await new MigrationExecutor(source).getAllMigrations();
    expect(resolved.map((migration) => migration.name)).toEqual(
      EXPECTED_MIGRATION_NAMES,
    );
  });
});

describe('CreateOrderedEventInfrastructure migration', () => {
  it('adds only neutral event tables and enforces immutable event rows', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const runner = { query } as unknown as QueryRunner;
    const migration = new CreateOrderedEventInfrastructure1784389500000();

    await migration.up(runner);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain('CREATE TABLE "event_stream_sequences"');
    expect(sql).toContain('CREATE TABLE "ordered_events"');
    expect(sql).toContain('CREATE TABLE "pruned_event_cursors"');
    expect(sql).toContain('UNIQUE ("stream_id", "sequence")');
    expect(sql).toContain('BEFORE UPDATE ON "ordered_events"');
    expect(sql).not.toContain('shopping_run_events');
  });
});
