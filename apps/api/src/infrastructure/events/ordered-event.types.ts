export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface EventRetention {
  readonly class: string;
  readonly retainUntil: string | null;
}

export interface AppendOrderedEventInput {
  readonly id: string;
  readonly streamId: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly occurredAt: Date | string;
  readonly actorType?: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly correlationId?: string | null;
  readonly retention: {
    readonly class: string;
    readonly retainUntil: Date | string | null;
  };
}

export interface OrderedEvent {
  readonly id: string;
  readonly streamId: string;
  readonly sequence: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly occurredAt: string;
  readonly persistedAt: string;
  readonly actorType: string | null;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly correlationId: string | null;
  readonly retention: EventRetention;
}

export interface AppendOrderedEventResult {
  readonly event: OrderedEvent;
  readonly duplicate: boolean;
}

export interface EventRetentionWindow {
  readonly oldestAvailableEventId: string | null;
  readonly oldestAvailableSequence: string | null;
  readonly latestSequence: string;
  readonly retainedFrom: string | null;
}

export interface OrderedEventPage {
  readonly events: readonly OrderedEvent[];
  readonly nextAfter: string | null;
  readonly hasMore: boolean;
  readonly retention: EventRetentionWindow;
}

export interface ReadOrderedEventsInput {
  readonly streamId: string;
  readonly after?: string;
  readonly limit?: number;
}

export interface PruneOrderedEventsInput {
  readonly streamId: string;
  readonly throughSequence: string;
  readonly prunedAt?: Date | string;
}

export interface PruneOrderedEventsResult {
  readonly prunedCount: number;
  readonly retention: EventRetentionWindow;
}

export interface PreparedOrderedEvent {
  readonly id: string;
  readonly streamId: string;
  readonly type: string;
  readonly schemaVersion: string;
  readonly occurredAt: string;
  readonly actorType: string | null;
  readonly payload: Readonly<Record<string, JsonValue>>;
  readonly correlationId: string | null;
  readonly retention: EventRetention;
  readonly contentFingerprint: string;
}
