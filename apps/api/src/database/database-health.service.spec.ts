import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatabaseHealthService } from './database-health.service';

describe('DatabaseHealthService', () => {
  it('requires every legacy and neutral foundation table', async () => {
    const query = jest
      .fn()
      .mockResolvedValue([
        { name: 'shopping_runs', relation: 'shopping_runs' },
      ]);
    const dataSource = {
      isInitialized: true,
      query,
    } as unknown as DataSource;
    const service = new DatabaseHealthService(
      new ConfigService({ database: { enabled: true } }),
      dataSource,
    );
    await expect(service.status()).resolves.toBe('down');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('to_regclass'), [
      expect.arrayContaining([
        'shopping_runs',
        'shopping_control_leases',
        'shopping_idempotency_records',
        'users',
        'authentication_sessions',
        'audit_records',
        'idempotency_records',
        'ordered_events',
        'testing_evidence_artifacts',
      ]),
    ]);
  });

  it('reports up only when every required relation resolves', async () => {
    const query = jest
      .fn()
      .mockImplementation((_statement: string, [names]: [string[]]) =>
        Promise.resolve(names.map((name) => ({ name, relation: name }))),
      );
    const service = new DatabaseHealthService(
      new ConfigService({ database: { enabled: true } }),
      { isInitialized: true, query } as unknown as DataSource,
    );

    await expect(service.status()).resolves.toBe('up');
  });

  it('reports disabled without touching a database when configured off', async () => {
    const query = jest.fn();
    const service = new DatabaseHealthService(
      new ConfigService({ database: { enabled: false } }),
      { isInitialized: true, query } as unknown as DataSource,
    );

    await expect(service.status()).resolves.toBe('disabled');
    expect(query).not.toHaveBeenCalled();
  });
});
