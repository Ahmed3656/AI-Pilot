import type { MigrationInterface } from 'typeorm';
import { CreateShoppingControlPlane1784299904203 } from './migrations/1784299904203-CreateShoppingControlPlane';
import { RemainingShoppingSchema1784301586974 } from './migrations/1784301586974-RemainingShoppingSchema';
import { CanonicalMvpContract1784303000000 } from './migrations/1784303000000-CanonicalMvpContract';
import { WidenEventDerivedIdentifiers1784304000000 } from './migrations/1784304000000-WidenEventDerivedIdentifiers';
import { CreateAuthAccounts1784304100000 } from './migrations/1784304100000-CreateAuthAccounts';
import { CreateAuditRecords1784304200000 } from './migrations/1784304200000-CreateAuditRecords';
import { PersistEvidenceScreenshots1784389400000 } from './migrations/1784389400000-PersistEvidenceScreenshots';
import { CreateIdempotencyRecords1784389500000 } from './migrations/1784389500000-CreateIdempotencyRecords';
import { CreateOrderedEventInfrastructure1784389500000 } from './migrations/1784389500000-CreateOrderedEventInfrastructure';
import { SecureAuthenticationSessions1784389500000 } from './migrations/1784389500000-SecureAuthenticationSessions';
import { CreateTestingEvidenceStorage1784390000000 } from './migrations/1784390000000-CreateTestingEvidenceStorage';
import { ReconcileFoundationUtcTimestamps1784390100000 } from './migrations/1784390100000-ReconcileFoundationUtcTimestamps';

type MigrationConstructor = new () => MigrationInterface;

/**
 * This explicit order preserves already-applied migration identities, including
 * the three merged migrations that share a timestamp, without loading test files.
 */
export const PLATFORM_MIGRATIONS = [
  CreateShoppingControlPlane1784299904203,
  RemainingShoppingSchema1784301586974,
  CanonicalMvpContract1784303000000,
  WidenEventDerivedIdentifiers1784304000000,
  CreateAuthAccounts1784304100000,
  CreateAuditRecords1784304200000,
  PersistEvidenceScreenshots1784389400000,
  CreateIdempotencyRecords1784389500000,
  CreateOrderedEventInfrastructure1784389500000,
  SecureAuthenticationSessions1784389500000,
  CreateTestingEvidenceStorage1784390000000,
  ReconcileFoundationUtcTimestamps1784390100000,
] as const satisfies readonly MigrationConstructor[];
