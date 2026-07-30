import { OrderedEventError } from './ordered-event.errors';
import { JsonValue } from './ordered-event.types';

export const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_PAYLOAD_DEPTH = 20;
const MAX_EVENT_PAYLOAD_KEYS = 2_000;
const MAX_EVENT_STRING_BYTES = 16 * 1024;

const FORBIDDEN_KEYS = new Set([
  'analysis',
  'apikey',
  'authorization',
  'authorizationheader',
  'chainofthought',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'formvalues',
  'hiddenreasoning',
  'internalthoughts',
  'localpath',
  'modelreasoning',
  'objectstoreurl',
  'password',
  'passwd',
  'privatekey',
  'privateurl',
  'rawrequest',
  'rawresponse',
  'reasoning',
  'secret',
  'secrets',
  'sessionid',
  'setcookie',
  'stacktrace',
  'token',
  'tokens',
]);
const FORBIDDEN_KEY_FRAGMENTS = [
  'accesstoken',
  'apikey',
  'authorization',
  'bearertoken',
  'chainofthought',
  'cookie',
  'hiddenreasoning',
  'idtoken',
  'internalthought',
  'modelreasoning',
  'password',
  'passwd',
  'privatekey',
  'refreshtoken',
  'secret',
  'viewertoken',
];

export function safeEventPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, JsonValue>> {
  if (!isPlainObject(payload)) forbidden('Payload must be a plain object');
  const counter = { keys: 0 };
  const normalized = normalizeValue(payload, '$', 0, counter);
  const serialized = JSON.stringify(normalized);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_PAYLOAD_BYTES)
    throw new OrderedEventError(
      'EVENT_PAYLOAD_TOO_LARGE',
      `Event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
    );
  return deepFreeze(normalized as Record<string, JsonValue>);
}

function normalizeValue(
  value: unknown,
  path: string,
  depth: number,
  counter: { keys: number },
): JsonValue {
  if (depth > MAX_EVENT_PAYLOAD_DEPTH)
    forbidden('Event payload nesting is too deep', path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) forbidden('Numbers must be finite', path);
    return value;
  }
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_EVENT_STRING_BYTES)
      throw new OrderedEventError(
        'EVENT_PAYLOAD_TOO_LARGE',
        'Event payload contains an oversized string artifact',
        { path },
      );
    if (/^data:/i.test(value) || looksLikeLargeBase64(value))
      forbidden('Inline artifacts are forbidden in event payloads', path);
    if (urlHasQueryString(value))
      forbidden(
        'URLs with query strings are forbidden in event payloads',
        path,
      );
    return value;
  }
  if (Array.isArray(value))
    return value.map((item, index) =>
      normalizeValue(item, `${path}[${index}]`, depth + 1, counter),
    );
  if (!isPlainObject(value))
    forbidden('Event payload contains a non-JSON value', path);

  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    counter.keys += 1;
    if (counter.keys > MAX_EVENT_PAYLOAD_KEYS)
      throw new OrderedEventError(
        'EVENT_PAYLOAD_TOO_LARGE',
        'Event payload contains too many fields',
      );
    assertSafeKey(key, `${path}.${key}`);
    const child = value[key];
    if (child === undefined)
      forbidden(
        'Undefined values are forbidden in event payloads',
        `${path}.${key}`,
      );
    normalized[key] = normalizeValue(
      child,
      `${path}.${key}`,
      depth + 1,
      counter,
    );
  }
  return normalized;
}

function assertSafeKey(key: string, path: string): void {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    key === '__proto__' ||
    key === 'constructor' ||
    key === 'prototype' ||
    FORBIDDEN_KEYS.has(normalized) ||
    FORBIDDEN_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment)) ||
    normalized.startsWith('token') ||
    normalized.endsWith('token') ||
    normalized.endsWith('tokens')
  )
    forbidden('Event payload contains a prohibited field', path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function urlHasQueryString(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).search.length > 0;
  } catch {
    return false;
  }
}

function looksLikeLargeBase64(value: string): boolean {
  return value.length > 1_024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function forbidden(message: string, path?: string): never {
  throw new OrderedEventError('EVENT_PAYLOAD_FORBIDDEN', message, {
    path: path ?? null,
  });
}

function deepFreeze<T extends JsonValue>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
