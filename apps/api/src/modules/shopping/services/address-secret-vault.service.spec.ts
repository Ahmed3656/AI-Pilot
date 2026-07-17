import { ConfigService } from '@nestjs/config';
import { AddressGrantDto } from '../dto';
import { AddressField } from '../shopping.types';
import { AddressSecretVaultService } from './address-secret-vault.service';

const grant: AddressGrantDto = {
  requestId: 'request-1',
  merchantDomains: ['talabat.com'],
  address: {
    recipientName: 'Test Recipient',
    mobileNumber: '01012345678',
    governorate: 'Cairo',
    cityOrArea: 'Nasr City',
    street: 'Test Street',
    building: '10',
    floor: '2',
    apartment: '4',
    landmark: 'Test Landmark',
    postalCode: '11765',
  },
};

describe('AddressSecretVaultService', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves one field only for the scoped run and merchant', () => {
    const vault = new AddressSecretVaultService(
      new ConfigService({ shopping: { addressTtlMs: 1_800_000 } }),
    );
    const stored = vault.store(
      'run-1',
      grant,
      new Date(Date.now() + 3_600_000),
    );
    expect(
      vault.resolve(
        'run-1',
        stored.secretReference,
        'talabat.com',
        AddressField.CityOrArea,
      ),
    ).toMatchObject({ value: 'Nasr City' });
    expect(() =>
      vault.resolve(
        'run-1',
        stored.secretReference,
        'amazon.eg',
        AddressField.CityOrArea,
      ),
    ).toThrow('does not authorize');
    vault.onModuleDestroy();
  });

  it('expires at the earlier address or browser TTL and can be compensated', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T10:00:00.000Z'));
    const vault = new AddressSecretVaultService(
      new ConfigService({ shopping: { addressTtlMs: 30_000 } }),
    );
    const stored = vault.store('run-1', grant, new Date(Date.now() + 1_000));
    expect(stored.expiresAt).toBe('2026-07-17T10:00:01.000Z');
    jest.advanceTimersByTime(1_001);
    expect(() =>
      vault.resolve(
        'run-1',
        stored.secretReference,
        'talabat.com',
        AddressField.Street,
      ),
    ).toThrow('expired');
    const second = vault.store('run-1', grant, new Date(Date.now() + 10_000));
    vault.delete(second.secretReference);
    expect(vault.has(second.secretReference)).toBe(false);
  });
});
