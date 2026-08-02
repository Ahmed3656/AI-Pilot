import { Injectable } from '@nestjs/common';
import type { PersistenceTransaction } from '../../database/persistence-transaction';
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
  OrderedEvent,
  OrderedEventPage,
  PreparedOrderedEvent,
  PruneOrderedEventsInput,
  PruneOrderedEventsResult,
  ReadOrderedEventsInput,
} from './ordered-event.types';

interface InMemoryStream {
  lastSequence: bigint;
  retainedFrom: string;
  readonly events: OrderedEvent[];
  readonly pruned: Map<
    string,
    { sequence: string; contentFingerprint: string }
  >;
}

@Injectable()
export class InMemoryOrderedEventRepository implements OrderedEventRepository {
  private readonly streams = new Map<string, InMemoryStream>();
  private readonly eventsById = new Map<
    string,
    { event: OrderedEvent; contentFingerprint: string }
  >();
  private readonly prunedById = new Map<
    string,
    { streamId: string; sequence: string; contentFingerprint: string }
  >();

  async append(
    input: AppendOrderedEventInput,
    transaction?: PersistenceTransaction,
  ): Promise<AppendOrderedEventResult> {
    await Promise.resolve();
    const prepared = prepareOrderedEvent(input);
    const existing = this.eventsById.get(prepared.id);
    if (existing)
      return duplicateResult(
        existing.event,
        existing.contentFingerprint,
        prepared,
      );
    const pruned = this.prunedById.get(prepared.id);
    if (pruned) {
      if (pruned.contentFingerprint !== prepared.contentFingerprint)
        throw eventIdConflict(prepared.id);
      throw expiredCursor(prepared.id, this.oldestEventId(pruned.streamId));
    }

    const streamWasCreated = !this.streams.has(prepared.streamId);
    const stream = this.stream(prepared.streamId);
    const previousSequence = stream.lastSequence;
    const sequence = stream.lastSequence + 1n;
    stream.lastSequence = sequence;
    const event = immutableOrderedEvent({
      id: prepared.id,
      streamId: prepared.streamId,
      sequence: sequence.toString(),
      type: prepared.type,
      schemaVersion: prepared.schemaVersion,
      occurredAt: prepared.occurredAt,
      persistedAt: new Date().toISOString(),
      actorType: prepared.actorType,
      payload: prepared.payload,
      correlationId: prepared.correlationId,
      retention: prepared.retention,
    });
    stream.events.push(event);
    this.eventsById.set(event.id, {
      event,
      contentFingerprint: prepared.contentFingerprint,
    });
    transaction?.afterRollback(() => {
      const index = stream.events.findIndex((stored) => stored.id === event.id);
      if (index >= 0) stream.events.splice(index, 1);
      this.eventsById.delete(event.id);
      if (stream.lastSequence === sequence)
        stream.lastSequence = previousSequence;
      if (
        streamWasCreated &&
        stream.events.length === 0 &&
        stream.pruned.size === 0
      )
        this.streams.delete(prepared.streamId);
    });
    return { event, duplicate: false };
  }

  async readPage(input: ReadOrderedEventsInput): Promise<OrderedEventPage> {
    await Promise.resolve();
    const limit = pageLimit(input.limit);
    const stream = this.streams.get(input.streamId);
    if (!stream) {
      if (input.after) throw unknownCursor(input.after);
      return {
        events: [],
        nextAfter: null,
        hasMore: false,
        retention: emptyRetention(),
      };
    }

    let cursor = 0n;
    if (input.after) {
      const active = this.eventsById.get(input.after);
      if (active?.event.streamId === input.streamId)
        cursor = BigInt(active.event.sequence);
      else if (stream.pruned.has(input.after))
        throw expiredCursor(input.after, this.oldestEventId(input.streamId));
      else throw unknownCursor(input.after);
    }

    const remaining = stream.events.filter(
      (event) => BigInt(event.sequence) > cursor,
    );
    const events = remaining.slice(0, limit);
    const hasMore = remaining.length > limit;
    return {
      events,
      nextAfter: hasMore ? (events.at(-1)?.id ?? null) : null,
      hasMore,
      retention: this.retention(input.streamId),
    };
  }

  async prune(
    input: PruneOrderedEventsInput,
  ): Promise<PruneOrderedEventsResult> {
    await Promise.resolve();
    const throughSequence = positiveSequence(input.throughSequence);
    const stream = this.streams.get(input.streamId);
    if (!stream) return { prunedCount: 0, retention: emptyRetention() };
    const prunedAt = validTimestamp(input.prunedAt ?? new Date(), 'prunedAt');
    const retained: OrderedEvent[] = [];
    let prunedCount = 0;
    for (const event of stream.events) {
      if (BigInt(event.sequence) <= throughSequence) {
        const indexed = this.eventsById.get(event.id);
        if (!indexed) continue;
        const tombstone = {
          sequence: event.sequence,
          contentFingerprint: indexed.contentFingerprint,
        };
        stream.pruned.set(event.id, tombstone);
        this.prunedById.set(event.id, {
          streamId: event.streamId,
          ...tombstone,
        });
        this.eventsById.delete(event.id);
        prunedCount += 1;
      } else retained.push(event);
    }
    if (prunedCount > 0) {
      stream.events.splice(0, stream.events.length, ...retained);
      stream.retainedFrom = prunedAt;
    }
    return {
      prunedCount,
      retention: this.retention(input.streamId),
    };
  }

  clear(): void {
    this.streams.clear();
    this.eventsById.clear();
    this.prunedById.clear();
  }

  private stream(streamId: string): InMemoryStream {
    let stream = this.streams.get(streamId);
    if (!stream) {
      stream = {
        lastSequence: 0n,
        retainedFrom: new Date().toISOString(),
        events: [],
        pruned: new Map(),
      };
      this.streams.set(streamId, stream);
    }
    return stream;
  }

  private oldestEventId(streamId: string): string | null {
    return this.streams.get(streamId)?.events[0]?.id ?? null;
  }

  private retention(streamId: string): EventRetentionWindow {
    const stream = this.streams.get(streamId);
    if (!stream) return emptyRetention();
    const oldest = stream.events[0];
    return Object.freeze({
      oldestAvailableEventId: oldest?.id ?? null,
      oldestAvailableSequence:
        oldest?.sequence ??
        (stream.lastSequence > 0n
          ? (stream.lastSequence + 1n).toString()
          : null),
      latestSequence: stream.lastSequence.toString(),
      retainedFrom: stream.retainedFrom,
    });
  }
}

function duplicateResult(
  event: OrderedEvent,
  existingFingerprint: string,
  prepared: PreparedOrderedEvent,
): AppendOrderedEventResult {
  // The fingerprint makes event-ID retries order-independent while rejecting collisions.
  if (existingFingerprint !== prepared.contentFingerprint)
    throw eventIdConflict(prepared.id);
  return { event, duplicate: true };
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

function emptyRetention(): EventRetentionWindow {
  return Object.freeze({
    oldestAvailableEventId: null,
    oldestAvailableSequence: null,
    latestSequence: '0',
    retainedFrom: null,
  });
}
