import { createHash } from 'node:crypto';
import { safeEventPayload } from './event-payload-policy';
import { OrderedEventError } from './ordered-event.errors';
import {
  AppendOrderedEventInput,
  JsonValue,
  OrderedEvent,
  PreparedOrderedEvent,
} from './ordered-event.types';

export function prepareOrderedEvent(
  input: AppendOrderedEventInput,
): PreparedOrderedEvent {
  const id = boundedString(input.id, 'id', 128);
  const streamId = boundedString(input.streamId, 'streamId', 128);
  const type = boundedString(input.type, 'type', 120);
  const schemaVersion = boundedString(input.schemaVersion, 'schemaVersion', 40);
  const actorType =
    input.actorType == null
      ? null
      : boundedString(input.actorType, 'actorType', 80);
  const correlationId =
    input.correlationId == null
      ? null
      : boundedString(input.correlationId, 'correlationId', 128);
  const retentionClass = boundedString(
    input.retention.class,
    'retention.class',
    40,
  );
  const occurredAt = timestamp(input.occurredAt, 'occurredAt');
  const retainUntil =
    input.retention.retainUntil == null
      ? null
      : timestamp(input.retention.retainUntil, 'retention.retainUntil');
  const payload = safeEventPayload(input.payload);
  const content = {
    actorType,
    correlationId,
    id,
    occurredAt,
    payload,
    retention: { class: retentionClass, retainUntil },
    schemaVersion,
    streamId,
    type,
  };
  return deepFreeze({
    ...content,
    contentFingerprint: createHash('sha256')
      .update(canonicalJson(content))
      .digest('hex'),
  });
}

export function immutableOrderedEvent(event: OrderedEvent): OrderedEvent {
  return deepFreeze({
    ...event,
    payload: cloneJson(event.payload) as Readonly<Record<string, JsonValue>>,
    retention: { ...event.retention },
  });
}

function boundedString(value: string, field: string, max: number): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.includes('\u0000')
  )
    throw new OrderedEventError(
      'EVENT_INPUT_INVALID',
      `${field} must contain 1-${max} safe characters`,
      { field },
    );
  return value;
}

function timestamp(value: Date | string, field: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new OrderedEventError(
      'EVENT_INPUT_INVALID',
      `${field} must be a valid timestamp`,
      { field },
    );
  return date.toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson(
          (value as Record<string, unknown>)[key],
        )}`,
    )
    .join(',')}}`;
}

function cloneJson(value: JsonValue): JsonValue {
  if (isJsonArray(value)) return value.map((item) => cloneJson(item));
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    );
  return value;
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
