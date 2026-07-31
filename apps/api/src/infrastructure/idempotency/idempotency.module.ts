import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IdempotencyRecord } from './idempotency-record.entity';
import { TypeormIdempotencyRepository } from './typeorm-idempotency.repository';
import { IDEMPOTENCY_CLOCK, IDEMPOTENCY_REPOSITORY } from './idempotency.types';
import { IdempotencyService } from './idempotency.service';

@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyRecord])],
  providers: [
    IdempotencyService,
    {
      provide: IDEMPOTENCY_CLOCK,
      useValue: () => new Date(),
    },
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useFactory: (dataSource: DataSource) =>
        new TypeormIdempotencyRepository(dataSource),
      inject: [DataSource],
    },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
