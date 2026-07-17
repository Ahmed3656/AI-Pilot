import { Module, Provider } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthModule } from '../auth/auth.module';
import {
  CouponAttempt,
  ControlLease,
  EvidenceArtifact,
  IdempotencyRecord,
  MerchantAttempt,
  NormalizedOffer,
  RunApproval,
  RunEvent,
  ShoppingRun,
} from './entities';
import { InternalShoppingController } from './internal-shopping.controller';
import {
  InMemoryShoppingStore,
  SHOPPING_STORE,
  TypeormShoppingStore,
} from './repositories';
import {
  AddressSecretVaultService,
  InternalTokenGuard,
  RunStateMachine,
  ShoppingAiClientService,
  ShoppingEventStreamService,
  ViewerTokenService,
  IdempotencyService,
  ShoppingReportService,
} from './services';
import { ShoppingController } from './shopping.controller';
import { ShoppingService } from './shopping.service';

const entities = [
  ShoppingRun,
  MerchantAttempt,
  NormalizedOffer,
  CouponAttempt,
  RunApproval,
  RunEvent,
  EvidenceArtifact,
  ControlLease,
  IdempotencyRecord,
];
const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

const storeProvider: Provider = databaseEnabled
  ? {
      provide: SHOPPING_STORE,
      useFactory: (
        runs: Repository<ShoppingRun>,
        attempts: Repository<MerchantAttempt>,
        offers: Repository<NormalizedOffer>,
        coupons: Repository<CouponAttempt>,
        approvals: Repository<RunApproval>,
        events: Repository<RunEvent>,
        evidence: Repository<EvidenceArtifact>,
        leases: Repository<ControlLease>,
        idempotency: Repository<IdempotencyRecord>,
      ) =>
        new TypeormShoppingStore(
          runs,
          attempts,
          offers,
          coupons,
          approvals,
          events,
          evidence,
          leases,
          idempotency,
        ),
      inject: entities.map((entity) => getRepositoryToken(entity)),
    }
  : { provide: SHOPPING_STORE, useClass: InMemoryShoppingStore };

@Module({
  imports: [
    AuthModule,
    ...(databaseEnabled ? [TypeOrmModule.forFeature(entities)] : []),
  ],
  controllers: [ShoppingController, InternalShoppingController],
  providers: [
    storeProvider,
    ShoppingService,
    RunStateMachine,
    AddressSecretVaultService,
    ShoppingAiClientService,
    ViewerTokenService,
    ShoppingEventStreamService,
    InternalTokenGuard,
    IdempotencyService,
    ShoppingReportService,
  ],
  exports: [ShoppingService, SHOPPING_STORE, AddressSecretVaultService],
})
export class ShoppingModule {}
