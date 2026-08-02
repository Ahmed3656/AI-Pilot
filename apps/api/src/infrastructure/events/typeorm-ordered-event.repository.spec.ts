import { DataSource, EntityManager } from 'typeorm';
import { PersistenceTransactionLifecycle } from '../../database/persistence-transaction';
import { TypeormOrderedEventRepository } from './typeorm-ordered-event.repository';
import { AppendOrderedEventInput } from './ordered-event.types';

describe('TypeormOrderedEventRepository sequence allocation', () => {
  it('uses transaction locks and an atomic PostgreSQL upsert for concurrent writers', async () => {
    let sequence = 0n;
    const sqlCalls: string[] = [];
    const query = jest.fn(
      (
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<unknown[]> => {
        sqlCalls.push(sql);
        if (sql.includes('FROM ordered_events')) return Promise.resolve([]);
        if (sql.includes('FROM pruned_event_cursors'))
          return Promise.resolve([]);
        if (sql.includes('INSERT INTO event_stream_sequences')) {
          sequence += 1n;
          return Promise.resolve([{ lastSequence: sequence.toString() }]);
        }
        if (sql.includes('INSERT INTO ordered_events')) {
          const now = new Date('2026-07-29T08:00:01.000Z');
          return Promise.resolve([
            {
              id: parameters[0],
              streamId: parameters[1],
              sequence: parameters[2],
              type: parameters[3],
              schemaVersion: parameters[4],
              actorType: parameters[5],
              payload: { status: 'executing' },
              occurredAt: parameters[7],
              persistedAt: now,
              correlationId: parameters[8],
              contentFingerprint: parameters[9],
              retentionClass: parameters[10],
              retainUntil: parameters[11],
            },
          ]);
        }
        return Promise.resolve([]);
      },
    );
    const manager = { query } as unknown as EntityManager;
    const dataSource = {
      transaction: <T>(operation: (value: EntityManager) => Promise<T>) =>
        operation(manager),
    } as DataSource;
    const repository = new TypeormOrderedEventRepository(dataSource);

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        repository.append(eventInput(`postgres-event-${index}`)),
      ),
    );

    expect(results.map((result) => result.event.sequence)).toEqual(
      Array.from({ length: 25 }, (_, index) => String(index + 1)),
    );
    expect(
      sqlCalls.some((sql) =>
        sql.includes('pg_advisory_xact_lock(hashtextextended($1, 0))'),
      ),
    ).toBe(true);
    expect(
      sqlCalls.some(
        (sql) =>
          sql.includes('ON CONFLICT (stream_id) DO UPDATE') &&
          sql.includes('event_stream_sequences.last_sequence + 1'),
      ),
    ).toBe(true);
  });

  it('joins a caller-owned manager without opening a nested transaction', async () => {
    const query = jest.fn(
      (
        sql: string,
        parameters: readonly unknown[] = [],
      ): Promise<unknown[]> => {
        if (sql.includes('FROM ordered_events')) return Promise.resolve([]);
        if (sql.includes('FROM pruned_event_cursors'))
          return Promise.resolve([]);
        if (sql.includes('INSERT INTO event_stream_sequences'))
          return Promise.resolve([{ lastSequence: '1' }]);
        if (sql.includes('INSERT INTO ordered_events'))
          return Promise.resolve([
            {
              id: parameters[0],
              streamId: parameters[1],
              sequence: parameters[2],
              type: parameters[3],
              schemaVersion: parameters[4],
              actorType: parameters[5],
              payload: { status: 'executing' },
              occurredAt: parameters[7],
              persistedAt: new Date('2026-07-29T08:00:01.000Z'),
              correlationId: parameters[8],
              contentFingerprint: parameters[9],
              retentionClass: parameters[10],
              retainUntil: parameters[11],
            },
          ]);
        return Promise.resolve([]);
      },
    );
    const manager = { query } as unknown as EntityManager;
    const databaseTransaction = jest.fn();
    const dataSource = {
      transaction: databaseTransaction,
    } as unknown as DataSource;
    const transaction = new PersistenceTransactionLifecycle(manager);

    await expect(
      new TypeormOrderedEventRepository(dataSource).append(
        eventInput('joined-event'),
        transaction,
      ),
    ).resolves.toMatchObject({
      event: { id: 'joined-event', sequence: '1' },
      duplicate: false,
    });
    expect(databaseTransaction).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
  });
});

function eventInput(id: string): AppendOrderedEventInput {
  return {
    id,
    streamId: 'stream-postgres',
    type: 'campaign.status_changed',
    schemaVersion: '1.0.0',
    occurredAt: '2026-07-29T08:00:00.000Z',
    actorType: 'system',
    payload: { status: 'executing' },
    correlationId: 'correlation-postgres',
    retention: {
      class: 'campaign',
      retainUntil: '2026-08-29T08:00:00.000Z',
    },
  };
}
