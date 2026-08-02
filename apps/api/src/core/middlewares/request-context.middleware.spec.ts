import { sanitizeRequestId } from './request-context.middleware';
import { canonicalRequestRoute } from '../request-context/request-context.service';

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

describe('canonicalRequestRoute', () => {
  it('never retains query values in request context', () => {
    expect(
      canonicalRequestRoute(
        '/api/v1/evidence?token=private-token&viewerUrl=https://private.test',
      ),
    ).toBe('/api/v1/evidence');
  });
});
