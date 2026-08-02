import {
  defaultErrorCode,
  sanitizeErrorMessage,
} from './all-exceptions.filter';

describe('global contract error defaults', () => {
  it('uses domain-neutral codes when an explicit contract code is absent', () => {
    expect(defaultErrorCode(403)).toBe('PERMISSION_DENIED');
    expect(defaultErrorCode(409)).toBe('INVALID_DOMAIN_TRANSITION');
    expect(defaultErrorCode(410)).toBe('CURSOR_EXPIRED');
    expect(defaultErrorCode(502)).toBe('EXECUTION_PROVIDER_UNAVAILABLE');
    expect(defaultErrorCode(503)).toBe('DEPENDENCY_UNAVAILABLE');
  });

  it('redacts credentials and URLs from safe error messages', () => {
    const message = sanitizeErrorMessage(
      'failed at https://private.test/path?token=value with Basic c2VjcmV0',
    );

    expect(message).not.toContain('private.test');
    expect(message).not.toContain('c2VjcmV0');
  });
});
