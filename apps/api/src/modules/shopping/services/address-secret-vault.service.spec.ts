import { ConfigService } from '@nestjs/config';
import { GoneException } from '@nestjs/common';
import { AddressGrantDto } from '../dto';
import { AddressField } from '../shopping.types';
import { AddressSecretVaultService } from './address-secret-vault.service';

const grant: AddressGrantDto = {
  merchantDomains: ['talabat.com'],
  address: {
    recipientName: 'Test Recipient',
    mobileNumber: '01012345678',
    governorate: 'Cairo',
    cityOrArea: 'Nasr City',
    street: 'Example Street',
    building: '10',
    floor: '2',
    apartment: '4',
    landmark: 'Example landmark',
    postalCode: '11765',
  },
};

describe('AddressSecretVaultService', () => {
  afterEach(() => jest.useRealTimers());

  it('resolves only one requested semantic field', () => {
    const vault = new AddressSecretVaultService(
      new ConfigService({ shopping: { addressTtlMs: 60_000 } }),
    );
    const stored = vault.store('run-1', grant);
    expect(
      vault.resolve(
        'run-1',
        stored.secretReference,
        'talabat.com',
        AddressField.CityOrArea,
      ),
    ).toBe('Nasr City');
    vault.onModuleDestroy();
  });

  it('deletes and refuses an expired address secret', () => {
    jest.useFakeTimers({ now: new Date('2026-01-01T00:00:00.000Z') });
    const vault = new AddressSecretVaultService(
      new ConfigService({ shopping: { addressTtlMs: 1_000 } }),
    );
    const stored = vault.store('run-1', grant);
    jest.advanceTimersByTime(1_000);
    expect(vault.has(stored.secretReference)).toBe(false);
    expect(() =>
      vault.resolve(
        'run-1',
        stored.secretReference,
        'talabat.com',
        AddressField.Street,
      ),
    ).toThrow(GoneException);
    vault.onModuleDestroy();
  });
});
