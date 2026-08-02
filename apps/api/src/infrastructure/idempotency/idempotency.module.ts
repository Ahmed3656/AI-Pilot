import { DynamicModule, Module, Provider } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { InMemoryIdempotencyRepository } from './in-memory-idempotency.repository';
import { TypeormIdempotencyRepository } from './typeorm-idempotency.repository';
import { IDEMPOTENCY_CLOCK, IDEMPOTENCY_REPOSITORY } from './idempotency.types';
import { IdempotencyService } from './idempotency.service';

export interface IdempotencyModuleOptions {
  databaseEnabled: boolean;
}

@Module({})
export class IdempotencyModule {
  static register(options: IdempotencyModuleOptions): DynamicModule {
    const repositoryProvider: Provider = options.databaseEnabled
      ? {
          provide: IDEMPOTENCY_REPOSITORY,
          useFactory: (dataSource: DataSource) =>
            new TypeormIdempotencyRepository(dataSource),
          inject: [DataSource],
        }
      : {
          provide: IDEMPOTENCY_REPOSITORY,
          useClass: InMemoryIdempotencyRepository,
        };

    return {
      module: IdempotencyModule,
      imports: options.databaseEnabled
        ? [TypeOrmModule.forFeature([IdempotencyRecord])]
        : [],
      providers: [
        IdempotencyService,
        {
          provide: IDEMPOTENCY_CLOCK,
          useValue: () => new Date(),
        },
        repositoryProvider,
      ],
      exports: [IdempotencyService, IDEMPOTENCY_CLOCK, IDEMPOTENCY_REPOSITORY],
    };
  }
}
