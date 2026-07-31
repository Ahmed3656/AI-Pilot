import { QueryRunner } from 'typeorm';
import { CreateOrderedEventInfrastructure1784389500000 } from './1784389500000-CreateOrderedEventInfrastructure';

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
