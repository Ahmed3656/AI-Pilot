import { DataSource } from 'typeorm';
import { TypeormIdempotencyRepository } from './typeorm-idempotency.repository';
import { IdempotencyExecutionRequest } from './idempotency.types';

describe('TypeormIdempotencyRepository', () => {
  it('uses a transaction-scoped PostgreSQL lock before saving a replayable response', async () => {
    const records = {
      findOneBy: jest.fn().mockResolvedValue(null),
      create: jest.fn((value: unknown) => value),
      save: jest.fn().mockImplementation(async (value: unknown) => value),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(records),
    };
    const dataSource = {
      transaction: jest.fn(
        (operation: (entityManager: typeof manager) => unknown) =>
          operation(manager),
      ),
    } as unknown as DataSource;
    const request = executionRequest();

    await expect(
      new TypeormIdempotencyRepository(dataSource).execute(request),
    ).resolves.toEqual({
      kind: 'executed',
      response: { status: 201, body: { id: 'run-1' } },
    });
    expect(manager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [
        JSON.stringify([
          'organization-1',
          'principal-1',
          'POST',
          '/api/v1/testing/runs',
          'idempotency-key-1',
        ]),
      ],
    );
    expect(records.save).toHaveBeenCalledWith(
      expect.objectContaining({
        requestFingerprint: 'a'.repeat(64),
        responseStatus: 201,
      }),
    );
  });

  it('returns the stored response and does not run the operation on replay', async () => {
    const records = {
      findOneBy: jest.fn().mockResolvedValue({
        expiresAt: new Date('2026-07-30T12:00:00.000Z'),
        requestFingerprint: 'a'.repeat(64),
        responseStatus: 202,
        responseBody: { accepted: true },
      }),
      create: jest.fn(),
      save: jest.fn(),
    };
    const manager = {
      query: jest.fn().mockResolvedValue(undefined),
      getRepository: jest.fn().mockReturnValue(records),
    };
    const dataSource = {
      transaction: jest.fn(
        (operation: (entityManager: typeof manager) => unknown) =>
          operation(manager),
      ),
    } as unknown as DataSource;
    const request = executionRequest();

    await expect(
      new TypeormIdempotencyRepository(dataSource).execute(request),
    ).resolves.toEqual({
      kind: 'replayed',
      response: { status: 202, body: { accepted: true } },
    });
    expect(request.operation).not.toHaveBeenCalled();
    expect(records.save).not.toHaveBeenCalled();
  });
});

function executionRequest(): IdempotencyExecutionRequest<{ id: string }> {
  return {
    scope: {
      organizationId: 'organization-1',
      principalId: 'principal-1',
      method: 'POST',
      canonicalPath: '/api/v1/testing/runs',
      key: 'idempotency-key-1',
    },
    requestFingerprint: 'a'.repeat(64),
    now: new Date('2026-07-29T12:00:00.000Z'),
    expiresAt: new Date('2026-07-30T12:00:00.000Z'),
    operation: jest.fn(async () => ({ status: 201, body: { id: 'run-1' } })),
  };
}
