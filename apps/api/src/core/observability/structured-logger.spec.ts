import { redactStructuredValue, redactUrl } from './structured-logger';

describe('structured log redaction', () => {
  it('recursively redacts address data and credentials', () => {
    expect(
      redactStructuredValue({
        event: 'address.granted',
        address: {
          recipientName: 'Secret Person',
          mobileNumber: '01012345678',
          cityOrArea: 'Nasr City',
          street: 'Secret Street',
        },
        nested: [{ authorization: 'Bearer secret' }],
      }),
    ).toEqual({
      event: 'address.granted',
      address: {
        recipientName: '[REDACTED]',
        mobileNumber: '[REDACTED]',
        cityOrArea: '[REDACTED]',
        street: '[REDACTED]',
      },
      nested: [{ authorization: '[REDACTED]' }],
    });
  });

  it('redacts viewer tokens and secret references in URLs', () => {
    expect(
      redactUrl('/v1/shopping/runs/run-1/events?token=signed-value&mode=view'),
    ).toBe('/v1/shopping/runs/run-1/events?token=%5BREDACTED%5D&mode=view');
    expect(redactUrl('/path?secretReference=address_private')).not.toContain(
      'address_private',
    );
  });
});
