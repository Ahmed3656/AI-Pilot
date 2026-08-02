import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { AuditModule } from '../../modules/audit/audit.module';
import { TestingEvidenceModule } from '../../modules/testing/evidence';
import { OrderedEventsModule } from '../events';
import { IdempotencyModule } from '../idempotency';

export interface NeutralFoundationModuleOptions {
  databaseEnabled: boolean;
  allowInMemoryObjectStorage: boolean;
  durablePrivateStorageRequired: boolean;
  objectStorageProvider?: Provider;
}

@Global()
@Module({})
export class NeutralFoundationModule {
  static register(options: NeutralFoundationModuleOptions): DynamicModule {
    const idempotency = IdempotencyModule.register({
      databaseEnabled: options.databaseEnabled,
    });
    const evidence = TestingEvidenceModule.register({
      databaseEnabled: options.databaseEnabled,
      allowInMemoryObjectStorage: options.allowInMemoryObjectStorage,
      durablePrivateStorageRequired: options.durablePrivateStorageRequired,
      objectStorageProvider: options.objectStorageProvider,
    });
    const orderedEvents = OrderedEventsModule.register({
      databaseEnabled: options.databaseEnabled,
    });
    const audit = AuditModule.register({
      databaseEnabled: options.databaseEnabled,
    });

    return {
      module: NeutralFoundationModule,
      imports: [idempotency, orderedEvents, audit, evidence],
      exports: [idempotency, orderedEvents, audit, evidence],
    };
  }
}
