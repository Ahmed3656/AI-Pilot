import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { ContractException } from '../../../core/filters/contract-exception';
import { AddressGrantDto, EgyptAddressDto } from '../dto';
import { AddressField } from '../shopping.types';

interface AddressGrant {
  runId: string;
  address: Readonly<EgyptAddressDto>;
  merchantDomains: ReadonlySet<string>;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

export interface StoredAddressGrant {
  secretReference: string;
  expiresAt: string;
}

@Injectable()
export class AddressSecretVaultService implements OnModuleDestroy {
  private readonly grants = new Map<string, AddressGrant>();
  private readonly ttlMs: number;

  constructor(config: ConfigService) {
    this.ttlMs = config.get<number>('shopping.addressTtlMs', 30 * 60 * 1000);
  }

  store(
    runId: string,
    dto: AddressGrantDto,
    browserExpiresAt: Date,
  ): StoredAddressGrant {
    const secretReference = `address_${randomBytes(24).toString('base64url')}`;
    const expiresAt = Math.min(
      Date.now() + this.ttlMs,
      browserExpiresAt.getTime(),
    );
    const delay = Math.max(0, expiresAt - Date.now());
    const timer = setTimeout(() => this.delete(secretReference), delay);
    timer.unref();
    this.grants.set(secretReference, {
      runId,
      address: Object.freeze({ ...dto.address }),
      merchantDomains: new Set(dto.merchantDomains),
      expiresAt,
      timer,
    });
    return { secretReference, expiresAt: new Date(expiresAt).toISOString() };
  }

  resolve(
    runId: string,
    secretReference: string,
    merchantDomain: string,
    field: AddressField,
  ): { value: string; expiresAt: string } {
    const grant = this.grants.get(secretReference);
    if (!grant || grant.expiresAt <= Date.now()) {
      if (grant) this.delete(secretReference);
      throw new ContractException(
        'ADDRESS_GRANT_EXPIRED',
        410,
        'Address grant is unavailable or expired',
      );
    }
    if (grant.runId !== runId || !grant.merchantDomains.has(merchantDomain)) {
      throw new ContractException(
        'DOMAIN_NOT_APPROVED',
        403,
        'Address grant does not authorize this domain',
      );
    }
    const value = grant.address[field];
    if (typeof value !== 'string')
      throw new ContractException(
        'VALIDATION_ERROR',
        400,
        'Requested optional address field has no value',
      );
    return { value, expiresAt: new Date(grant.expiresAt).toISOString() };
  }

  has(secretReference: string): boolean {
    const grant = this.grants.get(secretReference);
    if (grant && grant.expiresAt <= Date.now()) this.delete(secretReference);
    return this.grants.has(secretReference);
  }

  delete(secretReference: string): void {
    const grant = this.grants.get(secretReference);
    if (grant) clearTimeout(grant.timer);
    this.grants.delete(secretReference);
  }

  deleteRun(runId: string): void {
    for (const [reference, grant] of this.grants)
      if (grant.runId === runId) this.delete(reference);
  }

  onModuleDestroy(): void {
    for (const reference of [...this.grants.keys()]) this.delete(reference);
  }
}
