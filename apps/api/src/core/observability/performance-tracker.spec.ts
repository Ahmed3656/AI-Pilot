import { errorFields, fingerprintQuery } from './performance-tracker';

describe('fingerprintQuery', () => {
  it('groups structurally identical queries without retaining values', () => {
    const first = fingerprintQuery(
      "SELECT * FROM users WHERE id = 42 AND email = 'one@example.com'",
    );
    const second = fingerprintQuery(
      "SELECT * FROM users WHERE id = 99 AND email = 'two@example.com'",
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe('errorFields', () => {
  it('does not copy arbitrary exception messages into structured logs', () => {
    const secret = 'Bearer private-access-token';

    expect(errorFields(new Error(`provider failed with ${secret}`))).toEqual({
      errorName: 'Error',
    });
    expect(JSON.stringify(errorFields(new Error(secret)))).not.toContain(
      'private-access-token',
    );
  });
});
