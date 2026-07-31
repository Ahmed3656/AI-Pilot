export interface AuditMetadata {
  [key: string]: AuditMetadataValue;
}

export type AuditMetadataValue =
  boolean | number | string | null | AuditMetadata | AuditMetadataValue[];

const FORBIDDEN_METADATA_KEY =
  /password|passphrase|secret|token|cookie|authorization|credential|api[_-]?key|prompt|response|body|headers?|screenshot|image(?:data|_url)?|viewer[_-]?url|(?:secret|credential|vault)[_-]?handle/i;

const AUTHORIZATION_VALUE = /^\s*(?:bearer|basic)\s+\S+/i;
const MAX_METADATA_BYTES = 8_192;

export function validateAuditMetadata(value: unknown): AuditMetadata {
  if (!isPlainObject(value)) {
    throw new AuditMetadataError('Audit metadata must be an object');
  }
  const normalized = normalizeObject(value, '$', new WeakSet<object>());
  const bytes = Buffer.byteLength(JSON.stringify(normalized), 'utf8');
  if (bytes > MAX_METADATA_BYTES) {
    throw new AuditMetadataError('Audit metadata is too large');
  }
  return normalized;
}

function normalizeMetadata(
  value: unknown,
  path: string,
  seen: WeakSet<object>,
): AuditMetadataValue {
  if (value === null) return null;
  if (typeof value === 'string') {
    if (AUTHORIZATION_VALUE.test(value)) {
      throw new AuditMetadataError(`Unsafe authorization value at ${path}`);
    }
    return value;
  }
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    if (seen.has(value))
      throw new AuditMetadataError('Audit metadata is cyclic');
    seen.add(value);
    return value.map((item, index) =>
      normalizeMetadata(item, `${path}[${index}]`, seen),
    );
  }
  if (isPlainObject(value)) {
    return normalizeObject(value, path, seen);
  }
  throw new AuditMetadataError(
    `Audit metadata must contain JSON values at ${path}`,
  );
}

function normalizeObject(
  value: Record<string, unknown>,
  path: string,
  seen: WeakSet<object>,
): AuditMetadata {
  if (seen.has(value)) throw new AuditMetadataError('Audit metadata is cyclic');
  seen.add(value);
  const normalized: AuditMetadata = {};
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      throw new AuditMetadataError(`Unsafe audit metadata key: ${key}`);
    }
    normalized[key] = normalizeMetadata(item, `${path}.${key}`, seen);
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export class AuditMetadataError extends Error {}
