import { warningListKey } from './report';

describe('warningListKey', () => {
  it('distinguishes identical warning occurrences', () => {
    const warning = {
      code: 'browser_warning',
      message:
        'The intended control could not be located after visual retries; user interaction is required to continue.',
      evidenceIds: [],
    };

    expect(warningListKey(warning, 0)).not.toBe(warningListKey(warning, 1));
  });
});
