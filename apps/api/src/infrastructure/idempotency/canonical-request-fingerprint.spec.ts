import {
  canonicalJson,
  canonicalRequestFingerprint,
} from './canonical-request-fingerprint';

describe('canonicalRequestFingerprint', () => {
  it('is stable across object key order', () => {
    expect(canonicalJson({ z: [true, null], a: { second: 2, first: 1 } })).toBe(
      canonicalJson({ a: { first: 1, second: 2 }, z: [true, null] }),
    );
  });

  it('preserves exact decimal and timestamp strings', () => {
    const base = {
      amount: '001.2300',
      occurredAt: '2026-07-29T00:00:00.000Z',
    };

    expect(canonicalRequestFingerprint(base)).not.toBe(
      canonicalRequestFingerprint({ ...base, amount: '1.23' }),
    );
    expect(canonicalRequestFingerprint(base)).not.toBe(
      canonicalRequestFingerprint({
        ...base,
        occurredAt: '2026-07-29T00:00:00+00:00',
      }),
    );
  });

  it('rejects values that do not have an unambiguous JSON representation', () => {
    expect(() => canonicalRequestFingerprint({ amount: Number.NaN })).toThrow(
      'non-finite number',
    );
    expect(() => canonicalRequestFingerprint({ absent: undefined })).toThrow(
      'non-JSON value',
    );
  });
});
