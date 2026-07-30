import { InMemoryOrderedEventRepository } from './in-memory-ordered-event.repository';
import { InProcessOrderedEventPublisher } from './in-process-ordered-event.publisher';
import { OrderedEventPublisher } from './ordered-event.publisher';
import { OrderedEventRepository } from './ordered-event.repository';
import { OrderedEventService } from './ordered-event.service';
import {
  AppendOrderedEventInput,
  AppendOrderedEventResult,
  OrderedEvent,
} from './ordered-event.types';

const occurredAt = '2026-07-29T08:00:00.000Z';
const retainUntil = '2026-08-29T08:00:00.000Z';

describe('ordered event infrastructure', () => {
  let repository: InMemoryOrderedEventRepository;
  let publish: jest.MockedFunction<OrderedEventPublisher['publish']>;
  let service: OrderedEventService;

  beforeEach(() => {
    repository = new InMemoryOrderedEventRepository();
    publish = jest.fn();
    service = new OrderedEventService(repository, { publish });
  });

  it('allocates one monotonic sequence per stream under concurrent appends', async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        service.append(eventInput(`event-${index}`)),
      ),
    );

    expect(results.map((result) => result.event.sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index + 1)),
    );
    const page = await service.readPage({ streamId: 'stream-1', limit: 100 });
    expect(page.events.map((event) => event.sequence)).toEqual(
      Array.from({ length: 50 }, (_, index) => String(index + 1)),
    );
    expect(new Set(page.events.map((event) => event.sequence)).size).toBe(50);
  });

  it('returns an identical duplicate and rejects an event-ID content collision', async () => {
    const first = await service.append(
      eventInput('event-duplicate', {
        payload: { z: 1, nested: { b: true, a: 'stable' } },
      }),
    );
    const duplicate = await service.append(
      eventInput('event-duplicate', {
        payload: { nested: { a: 'stable', b: true }, z: 1 },
      }),
    );

    expect(duplicate).toEqual({ event: first.event, duplicate: true });
    expect(publish).toHaveBeenCalledTimes(1);
    await expect(
      service.append(
        eventInput('event-duplicate', {
          payload: { nested: { a: 'changed', b: true }, z: 1 },
        }),
      ),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });
  });

  it('uses exclusive event-ID cursors and returns retention metadata', async () => {
    await service.append(eventInput('event-1'));
    await service.append(eventInput('event-2'));
    await service.append(eventInput('event-3'));

    const first = await service.readPage({ streamId: 'stream-1', limit: 2 });
    expect(first).toMatchObject({
      events: [{ id: 'event-1' }, { id: 'event-2' }],
      hasMore: true,
      nextAfter: 'event-2',
      retention: {
        oldestAvailableEventId: 'event-1',
        oldestAvailableSequence: '1',
        latestSequence: '3',
      },
    });
    const second = await service.readPage({
      streamId: 'stream-1',
      after: first.nextAfter ?? undefined,
      limit: 2,
    });
    expect(second).toMatchObject({
      events: [{ id: 'event-3' }],
      hasMore: false,
      nextAfter: null,
    });
  });

  it('distinguishes unknown cursors from pruned cursors', async () => {
    await service.append(eventInput('event-1'));
    await service.append(eventInput('event-2'));

    await expect(
      service.readPage({
        streamId: 'stream-1',
        after: 'never-existed',
      }),
    ).rejects.toMatchObject({ code: 'EVENT_ID_CONFLICT' });

    const pruned = await service.prune({
      streamId: 'stream-1',
      throughSequence: '1',
      prunedAt: '2026-07-30T08:00:00.000Z',
    });
    expect(pruned).toMatchObject({
      prunedCount: 1,
      retention: {
        oldestAvailableEventId: 'event-2',
        oldestAvailableSequence: '2',
        retainedFrom: '2026-07-30T08:00:00.000Z',
      },
    });
    await expect(
      service.readPage({ streamId: 'stream-1', after: 'event-1' }),
    ).rejects.toMatchObject({
      code: 'EVENT_CURSOR_EXPIRED',
      metadata: { oldestAvailableEventId: 'event-2' },
    });
  });

  it.each([
    [{ apiToken: 'not-safe' }, 'EVENT_PAYLOAD_FORBIDDEN'],
    [{ accessTokenValue: 'not-safe' }, 'EVENT_PAYLOAD_FORBIDDEN'],
    [{ chainOfThought: 'hidden reasoning' }, 'EVENT_PAYLOAD_FORBIDDEN'],
    [
      { screenshot: `data:image/png;base64,${'a'.repeat(128)}` },
      'EVENT_PAYLOAD_FORBIDDEN',
    ],
    [{ artifact: 'a'.repeat(65 * 1024) }, 'EVENT_PAYLOAD_TOO_LARGE'],
    [
      { sourceUrl: 'https://target.example/path?session=private' },
      'EVENT_PAYLOAD_FORBIDDEN',
    ],
  ])('rejects unsafe payload %p', async (payload, code) => {
    await expect(
      service.append(
        eventInput(`unsafe-${code}-${JSON.stringify(payload).length}`, {
          payload,
        }),
      ),
    ).rejects.toMatchObject({ code });
    expect(publish).not.toHaveBeenCalled();
  });

  it('returns deeply immutable stored events', async () => {
    const result = await service.append(
      eventInput('event-immutable', {
        payload: { nested: { value: 'fixed' } },
      }),
    );

    expect(Object.isFrozen(result.event)).toBe(true);
    expect(Object.isFrozen(result.event.payload)).toBe(true);
    expect(Object.isFrozen(result.event.payload.nested)).toBe(true);
    expect(Object.isFrozen(result.event.retention)).toBe(true);
  });

  it('publishes only after commit and does not republish duplicates', async () => {
    let resolveAppend: ((value: AppendOrderedEventResult) => void) | undefined;
    const append = jest.fn(
      () =>
        new Promise<AppendOrderedEventResult>((resolve) => {
          resolveAppend = resolve;
        }),
    );
    const deferredRepository = {
      append,
      readPage: jest.fn(),
      prune: jest.fn(),
    } as unknown as OrderedEventRepository;
    const deferredPublish = jest.fn();
    const deferredService = new OrderedEventService(deferredRepository, {
      publish: deferredPublish,
    });
    const pending = deferredService.append(eventInput('event-commit'));

    expect(deferredPublish).not.toHaveBeenCalled();
    const committedEvent = sampleStoredEvent('event-commit');
    resolveAppend?.({ event: committedEvent, duplicate: false });
    await expect(pending).resolves.toMatchObject({ duplicate: false });
    expect(deferredPublish).toHaveBeenCalledWith(committedEvent);

    append.mockResolvedValueOnce({ event: committedEvent, duplicate: true });
    await deferredService.append(eventInput('event-commit'));
    expect(deferredPublish).toHaveBeenCalledTimes(1);
  });

  it('delivers in-process subscriptions only for their stream', async () => {
    const publisher = new InProcessOrderedEventPublisher();
    const listener = jest.fn();
    const subscription = publisher.subscribe('stream-1', listener);
    const liveService = new OrderedEventService(repository, publisher);

    await liveService.append(eventInput('event-live'));
    await liveService.append(
      eventInput('event-other-stream', { streamId: 'stream-2' }),
    );
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'event-live', streamId: 'stream-1' }),
    );

    subscription.unsubscribe();
    await liveService.append(eventInput('event-unsubscribed'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

function eventInput(
  id: string,
  overrides: Partial<AppendOrderedEventInput> = {},
): AppendOrderedEventInput {
  return {
    id,
    streamId: 'stream-1',
    type: 'campaign.status_changed',
    schemaVersion: '1.0.0',
    occurredAt,
    actorType: 'system',
    payload: { status: 'executing' },
    correlationId: 'correlation-1',
    retention: { class: 'campaign', retainUntil },
    ...overrides,
  };
}

function sampleStoredEvent(id: string): OrderedEvent {
  return Object.freeze({
    id,
    streamId: 'stream-1',
    sequence: '1',
    type: 'campaign.status_changed',
    schemaVersion: '1.0.0',
    occurredAt,
    persistedAt: occurredAt,
    actorType: 'system',
    payload: Object.freeze({ status: 'executing' }),
    correlationId: 'correlation-1',
    retention: Object.freeze({ class: 'campaign', retainUntil }),
  });
}
