import { sanitizeRequestId } from './request-context.middleware';

describe('sanitizeRequestId', () => {
  it('keeps safe caller-provided correlation IDs', () => {
    expect(sanitizeRequestId(' mobile_01.request-2 ')).toBe(
      'mobile_01.request-2',
    );
  });

  it('replaces unsafe IDs', () => {
    expect(sanitizeRequestId('bad request id\n')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
