import { Test } from '@nestjs/testing';
import { IdempotencyModule } from './idempotency.module';
import { IdempotencyService } from './idempotency.service';
import { InMemoryIdempotencyRepository } from './in-memory-idempotency.repository';
import {
  IDEMPOTENCY_CLOCK,
  IDEMPOTENCY_REPOSITORY,
  type IdempotencyClock,
  type IdempotencyRepository,
} from './idempotency.types';

describe('IdempotencyModule', () => {
  it('resolves deterministic in-memory providers without a DataSource', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyModule.register({ databaseEnabled: false })],
    }).compile();

    expect(moduleRef.get(IdempotencyService)).toBeInstanceOf(
      IdempotencyService,
    );
    expect(
      moduleRef.get<IdempotencyRepository>(IDEMPOTENCY_REPOSITORY),
    ).toBeInstanceOf(InMemoryIdempotencyRepository);
    expect(moduleRef.get<IdempotencyClock>(IDEMPOTENCY_CLOCK)()).toBeInstanceOf(
      Date,
    );

    await moduleRef.close();
  });
});
