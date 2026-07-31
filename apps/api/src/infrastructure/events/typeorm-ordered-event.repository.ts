import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import {
  eventIdConflict,
  expiredCursor,
  OrderedEventError,
  unknownCursor,
} from './ordered-event.errors';
import {
  immutableOrderedEvent,
  prepareOrderedEvent,
} from './ordered-event-content';
import { OrderedEventRepository } from './ordered-event.repository';
import {
  AppendOrderedEventInput,
  AppendOrderedEventResult,
  EventRetentionWindow,
  JsonValue,
  OrderedEvent,
  OrderedEventPage,
  PreparedOrderedEvent,
  PruneOrderedEventsInput,
  PruneOrderedEventsResult,
  ReadOrderedEventsInput,
} from './ordered-event.types';

interface EventRow {
  id: string;
  streamId: string;
  sequence: string;
  type: string;
  schemaVersion: string;
  occurredAt: Date | string;
  persistedAt: Date | string;
  actorType: string | null;
  payload: Record<string, JsonValue>;
  correlationId: string | null;
  retentionClass: string;
  retainUntil: Date | string | null;
  contentFingerprint: string;
}

interface StreamRow {
  lastSequence: string;
  retainedFrom: Date | string;
}

@Injectable()
export class TypeormOrderedEventRepository implements OrderedEventRepository {
  constructor(private readonly dataSource: DataSource) {}

  async append(
    input: AppendOrderedEventInput,
  ): Promise<AppendOrderedEventResult> {
    const prepared = prepareOrderedEvent(input);
    return await this.dataSource.transaction(async (manager) => {
      // The transaction lock serializes reuse of one global event ID, including across streams.
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [prepared.id],
      );
      const existing = await findEvent(manager, prepared.id);
      if (existing) return duplicateResult(existing, prepared);
      const [pruned] = await manager.query<
        Array<{ streamId: string; contentFingerprint: string }>
      >(
        `
          SELECT stream_id AS "streamId",
                 content_fingerprint AS "contentFingerprint"
          FROM pruned_event_cursors
          WHERE event_id = $1
        `,
        [prepared.id],
      );
      if (pruned) {
        if (pruned.contentFingerprint !== prepared.contentFingerprint)
          throw eventIdConflict(prepared.id);
        throw expiredCursor(
          prepared.id,
          await oldestEventId(manager, pruned.streamId),
        );
      }

      const [sequenceRow] = await manager.query<
        Array<{ lastSequence: string }>
      >(
        `
          INSERT INTO event_stream_sequences (
            stream_id,
            last_sequence,
            retained_from,
            created_at,
            updated_at
          )
          VALUES ($1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (stream_id) DO UPDATE
          SET last_sequence = event_stream_sequences.last_sequence + 1,
              updated_at = CURRENT_TIMESTAMP
          RETURNING last_sequence AS "lastSequence"
        `,
        [prepared.streamId],
      );
      if (!sequenceRow)
        throw new Error('Ordered event sequence allocation returned no row');

      const [inserted] = await manager.query<EventRow[]>(
        `
          INSERT INTO ordered_events (
            event_id,
            stream_id,
            sequence,
            event_type,
            schema_version,
            actor_type,
            safe_payload,
            occurred_at,
            persisted_at,
            correlation_id,
            content_fingerprint,
            retention_class,
            retain_until
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb,
            $8::timestamptz,
            CURRENT_TIMESTAMP,
            $9,
            $10,
            $11,
            $12::timestamptz
          )
          RETURNING ${eventColumns()}
        `,
        [
          prepared.id,
          prepared.streamId,
          sequenceRow.lastSequence,
          prepared.type,
          prepared.schemaVersion,
          prepared.actorType,
          JSON.stringify(prepared.payload),
          prepared.occurredAt,
          prepared.correlationId,
          prepared.contentFingerprint,
          prepared.retention.class,
          prepared.retention.retainUntil,
        ],
      );
      if (!inserted) throw new Error('Ordered event insert returned no row');
      return { event: rowToEvent(inserted), duplicate: false };
    });
  }

  async readPage(input: ReadOrderedEventsInput): Promise<OrderedEventPage> {
    const limit = pageLimit(input.limit);
    const [stream] = await this.dataSource.query<StreamRow[]>(
      `
        SELECT last_sequence AS "lastSequence",
               retained_from AS "retainedFrom"
        FROM event_stream_sequences
        WHERE stream_id = $1
      `,
      [input.streamId],
    );
    if (!stream) {
      if (input.after) throw unknownCursor(input.after);
      return {
        events: [],
        nextAfter: null,
        hasMore: false,
        retention: emptyRetention(),
      };
    }

    let sequence = '0';
    if (input.after) {
      const [cursor] = await this.dataSource.query<Array<{ sequence: string }>>(
        `
          SELECT sequence
          FROM ordered_events
          WHERE stream_id = $1 AND event_id = $2
        `,
        [input.streamId, input.after],
      );
      if (cursor) sequence = cursor.sequence;
      else {
        const [pruned] = await this.dataSource.query<
          Array<{ sequence: string }>
        >(
          `
            SELECT sequence
            FROM pruned_event_cursors
            WHERE stream_id = $1 AND event_id = $2
          `,
          [input.streamId, input.after],
        );
        if (pruned)
          throw expiredCursor(
            input.after,
            await oldestEventId(this.dataSource.manager, input.streamId),
          );
        throw unknownCursor(input.after);
      }
    }

    const rows = await this.dataSource.query<EventRow[]>(
      `
        SELECT ${eventColumns()}
        FROM ordered_events
        WHERE stream_id = $1 AND sequence > $2::bigint
        ORDER BY sequence ASC
        LIMIT $3
      `,
      [input.streamId, sequence, limit + 1],
    );
    const hasMore = rows.length > limit;
    const events = rows.slice(0, limit).map(rowToEvent);
    return {
      events,
      nextAfter: hasMore ? (events.at(-1)?.id ?? null) : null,
      hasMore,
      retention: await retentionWindow(
        this.dataSource.manager,
        input.streamId,
        stream,
      ),
    };
  }

  async prune(
    input: PruneOrderedEventsInput,
  ): Promise<PruneOrderedEventsResult> {
    const throughSequence = positiveSequence(input.throughSequence);
    const prunedAt = validTimestamp(input.prunedAt ?? new Date(), 'prunedAt');
    return await this.dataSource.transaction(async (manager) => {
      // Pruning takes the stream row lock so it cannot race an append boundary.
      const [stream] = await manager.query<StreamRow[]>(
        `
          SELECT last_sequence AS "lastSequence",
                 retained_from AS "retainedFrom"
          FROM event_stream_sequences
          WHERE stream_id = $1
          FOR UPDATE
        `,
        [input.streamId],
      );
      if (!stream) return { prunedCount: 0, retention: emptyRetention() };

      const pruned = await manager.query<Array<{ eventId: string }>>(
        `
          WITH removed AS (
            DELETE FROM ordered_events
            WHERE stream_id = $1 AND sequence <= $2::bigint
            RETURNING event_id, stream_id, sequence, content_fingerprint
          )
          INSERT INTO pruned_event_cursors (
            event_id,
            stream_id,
            sequence,
            content_fingerprint,
            pruned_at
          )
          SELECT
            event_id,
            stream_id,
            sequence,
            content_fingerprint,
            $3::timestamptz
          FROM removed
          ON CONFLICT (event_id) DO NOTHING
          RETURNING event_id
        `,
        [input.streamId, throughSequence.toString(), prunedAt],
      );
      if (pruned.length > 0) {
        await manager.query(
          `
            UPDATE event_stream_sequences
            SET retained_from = $2::timestamptz,
                updated_at = CURRENT_TIMESTAMP
            WHERE stream_id = $1
          `,
          [input.streamId, prunedAt],
        );
        stream.retainedFrom = prunedAt;
      }
      return {
        prunedCount: pruned.length,
        retention: await retentionWindow(manager, input.streamId, stream),
      };
    });
  }
}

async function findEvent(
  manager: EntityManager,
  eventId: string,
): Promise<EventRow | null> {
  const [event] = await manager.query<EventRow[]>(
    `
      SELECT ${eventColumns()}
      FROM ordered_events
      WHERE event_id = $1
    `,
    [eventId],
  );
  return event ?? null;
}

function duplicateResult(
  row: EventRow,
  prepared: PreparedOrderedEvent,
): AppendOrderedEventResult {
  // Stored fingerprints make identical retries idempotent and content collisions explicit.
  if (row.contentFingerprint !== prepared.contentFingerprint)
    throw eventIdConflict(prepared.id);
  return { event: rowToEvent(row), duplicate: true };
}

function rowToEvent(row: EventRow): OrderedEvent {
  return immutableOrderedEvent({
    id: row.id,
    streamId: row.streamId,
    sequence: String(row.sequence),
    type: row.type,
    schemaVersion: row.schemaVersion,
    occurredAt: iso(row.occurredAt),
    persistedAt: iso(row.persistedAt),
    actorType: row.actorType,
    payload: row.payload,
    correlationId: row.correlationId,
    retention: {
      class: row.retentionClass,
      retainUntil: row.retainUntil == null ? null : iso(row.retainUntil),
    },
  });
}

function eventColumns(): string {
  return `
    event_id AS "id",
    stream_id AS "streamId",
    sequence,
    event_type AS "type",
    schema_version AS "schemaVersion",
    occurred_at AS "occurredAt",
    persisted_at AS "persistedAt",
    actor_type AS "actorType",
    safe_payload AS "payload",
    correlation_id AS "correlationId",
    retention_class AS "retentionClass",
    retain_until AS "retainUntil",
    content_fingerprint AS "contentFingerprint"
  `;
}

async function retentionWindow(
  manager: EntityManager,
  streamId: string,
  stream: StreamRow,
): Promise<EventRetentionWindow> {
  const [oldest] = await manager.query<Array<{ id: string; sequence: string }>>(
    `
      SELECT event_id AS "id", sequence
      FROM ordered_events
      WHERE stream_id = $1
      ORDER BY sequence ASC
      LIMIT 1
    `,
    [streamId],
  );
  return Object.freeze({
    oldestAvailableEventId: oldest?.id ?? null,
    oldestAvailableSequence:
      oldest?.sequence ??
      (BigInt(stream.lastSequence) > 0n
        ? (BigInt(stream.lastSequence) + 1n).toString()
        : null),
    latestSequence: String(stream.lastSequence),
    retainedFrom: iso(stream.retainedFrom),
  });
}

async function oldestEventId(
  manager: EntityManager,
  streamId: string,
): Promise<string | null> {
  const [oldest] = await manager.query<Array<{ id: string }>>(
    `
      SELECT event_id AS "id"
      FROM ordered_events
      WHERE stream_id = $1
      ORDER BY sequence ASC
      LIMIT 1
    `,
    [streamId],
  );
  return oldest?.id ?? null;
}

function pageLimit(value: number | undefined): number {
  const limit = value ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500)
    throw new OrderedEventError(
      'EVENT_INPUT_INVALID',
      'Event page limit must be an integer from 1 to 500',
      { field: 'limit' },
    );
  return limit;
}

function positiveSequence(value: string): bigint {
  if (!/^[1-9]\d*$/.test(value))
    throw new OrderedEventError(
      'EVENT_INPUT_INVALID',
      'throughSequence must be a positive decimal integer string',
      { field: 'throughSequence' },
    );
  return BigInt(value);
}

function validTimestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new OrderedEventError(
      'EVENT_INPUT_INVALID',
      `${field} must be a valid timestamp`,
      { field },
    );
  return date.toISOString();
}

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function emptyRetention(): EventRetentionWindow {
  return Object.freeze({
    oldestAvailableEventId: null,
    oldestAvailableSequence: null,
    latestSequence: '0',
    retainedFrom: null,
  });
}
