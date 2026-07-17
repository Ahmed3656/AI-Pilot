import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { DatabaseHealthService } from './database-health.service';

describe('DatabaseHealthService', () => {
  it('requires every shopping table rather than accepting SELECT 1', async () => {
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
      ]),
    ]);
  });
});
