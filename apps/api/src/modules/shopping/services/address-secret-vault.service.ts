import {
  ForbiddenException,
  GoneException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
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

  store(runId: string, dto: AddressGrantDto): StoredAddressGrant {
    const secretReference = `address_${randomBytes(24).toString('base64url')}`;
    const expiresAt = Date.now() + this.ttlMs;
    const timer = setTimeout(
      () => this.deleteGrant(secretReference),
      this.ttlMs,
    );
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
  ): string | null {
    const grant = this.grants.get(secretReference);
    if (!grant || grant.expiresAt <= Date.now()) {
      if (grant) this.deleteGrant(secretReference);
      throw new GoneException('Address grant is unavailable or expired');
    }
    if (grant.runId !== runId || !grant.merchantDomains.has(merchantDomain)) {
      throw new ForbiddenException(
        'Address grant does not authorize this request',
      );
    }
    return grant.address[field] ?? null;
  }

  has(secretReference: string): boolean {
    const grant = this.grants.get(secretReference);
    if (grant && grant.expiresAt <= Date.now())
      this.deleteGrant(secretReference);
    return this.grants.has(secretReference);
  }

  onModuleDestroy(): void {
    for (const reference of this.grants.keys()) this.deleteGrant(reference);
  }

  private deleteGrant(secretReference: string): void {
    const grant = this.grants.get(secretReference);
    if (grant) clearTimeout(grant.timer);
    this.grants.delete(secretReference);
  }
}
