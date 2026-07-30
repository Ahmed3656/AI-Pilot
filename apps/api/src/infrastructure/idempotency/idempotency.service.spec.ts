import { ContractException } from '../../core/filters/contract-exception';
import { InMemoryIdempotencyRepository } from './in-memory-idempotency.repository';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyScope } from './idempotency.types';

describe('IdempotencyService', () => {
  let now: Date;
  let service: IdempotencyService;

  beforeEach(() => {
    now = new Date('2026-07-29T12:00:00.000Z');
    service = new IdempotencyService(
      new InMemoryIdempotencyRepository(),
      () => now,
    );
  });

  it('replays the original status and body for an identical request', async () => {
    const operation = jest.fn(async () => ({
      status: 201,
      body: { id: 'run-1', amount: '10.00' },
    }));
    const first = await service.execute(
      scope(),
      { amount: '10.00' },
      operation,
    );
    const replay = await service.execute(
      scope(),
      { amount: '10.00' },
      operation,
    );

    expect(first).toEqual({
      status: 201,
      body: { id: 'run-1', amount: '10.00' },
    });
    expect(replay).toEqual(first);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('returns the stable conflict code when a key is reused with a changed body', async () => {
    await service.execute(scope(), { amount: '10.00' }, async () => ({
      status: 201,
      body: { id: 'run-1' },
    }));

    await expect(
      service.execute(scope(), { amount: '10.0' }, async () => ({
        status: 201,
        body: { id: 'run-2' },
      })),
    ).rejects.toMatchObject<Partial<ContractException>>({
      code: 'IDEMPOTENCY_KEY_REUSED',
      status: 409,
    });
  });

  it('isolates records by organization, principal, and canonical path', async () => {
    const operation = jest.fn(async () => ({
      status: 200,
      body: { ok: true },
    }));
    await service.execute(scope(), { action: 'create' }, operation);
    await service.execute(
      scope({ organizationId: 'organization-2' }),
      { action: 'create' },
      operation,
    );
    await service.execute(
      scope({ principalId: 'principal-2' }),
      { action: 'create' },
      operation,
    );
    await service.execute(
      scope({ canonicalPath: '/api/v1/testing/runs/run-2' }),
      { action: 'create' },
      operation,
    );

    expect(operation).toHaveBeenCalledTimes(4);
  });

  it('serializes concurrent identical calls and replays after the first commit', async () => {
    let release!: () => void;
    const completed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let startedResolve!: () => void;
    const started = new Promise<void>((resolve) => {
      startedResolve = resolve;
    });
    const operation = jest.fn(async () => {
      startedResolve();
      await completed;
      return { status: 202, body: { accepted: true } };
    });

    const first = service.execute(scope(), { action: 'start' }, operation);
    await started;
    const duplicate = service.execute(scope(), { action: 'start' }, operation);
    release();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([
      { status: 202, body: { accepted: true } },
      { status: 202, body: { accepted: true } },
    ]);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('expires records after 24 hours and never stores a failed operation', async () => {
    await expect(
      service.execute(scope(), { action: 'start' }, async () => {
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const operation = jest.fn(async () => ({
      status: 201,
      body: { id: 'run-1' },
    }));
    await service.execute(scope(), { action: 'start' }, operation);
    now = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await service.execute(scope(), { action: 'start' }, operation);

    expect(operation).toHaveBeenCalledTimes(2);
  });
});

function scope(overrides: Partial<IdempotencyScope> = {}): IdempotencyScope {
  return {
    organizationId: 'organization-1',
    principalId: 'principal-1',
    method: 'POST',
    canonicalPath: '/api/v1/testing/runs',
    key: 'idempotency-key-1',
    ...overrides,
  };
}
