import { ConfigService } from '@nestjs/config';
import { DatabaseHealthService } from '../../database/database-health.service';
import { ObjectStorageHealthPort } from '../../infrastructure/object-storage';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('accepts deterministic database-disabled composition outside production', async () => {
    const service = createService('test', 'disabled');

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'disabled', objectStorage: 'disabled' },
    });
  });

  it('fails closed when production database persistence is disabled', async () => {
    const service = createService('production', 'disabled');

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      dependencies: { database: 'disabled', objectStorage: 'disabled' },
    });
  });

  it('fails readiness when the configured database is down', async () => {
    const service = createService('test', 'down');

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      dependencies: { database: 'down', objectStorage: 'disabled' },
    });
  });

  it('fails closed when required durable object storage is down', async () => {
    const service = createService('production', 'up', true, 'down');

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'error',
      dependencies: { database: 'up', objectStorage: 'down' },
    });
  });

  it('reports ready when all required durable dependencies are up', async () => {
    const service = createService('production', 'up', true, 'up');

    await expect(service.readiness()).resolves.toMatchObject({
      status: 'ok',
      dependencies: { database: 'up', objectStorage: 'up' },
    });
  });
});

function createService(
  nodeEnv: string,
  databaseStatus: 'disabled' | 'up' | 'down',
  durablePrivateStorageRequired = false,
  storageStatus: 'up' | 'down' = 'up',
): HealthService {
  const database = {
    status: jest.fn().mockResolvedValue(databaseStatus),
  } as unknown as DatabaseHealthService;
  const objectStorage = {
    status: jest.fn().mockResolvedValue(storageStatus),
  } satisfies ObjectStorageHealthPort;
  return new HealthService(
    new ConfigService({
      app: { name: 'test-api', nodeEnv },
      objectStorage: { durablePrivateStorageRequired },
    }),
    database,
    objectStorage,
  );
}
