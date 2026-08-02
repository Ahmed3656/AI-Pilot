import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseHealthService } from '../../database/database-health.service';
import {
  OBJECT_STORAGE_HEALTH,
  ObjectStorageHealthPort,
} from '../../infrastructure/object-storage';

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseHealthService,
    @Optional()
    @Inject(OBJECT_STORAGE_HEALTH)
    private readonly objectStorage?: ObjectStorageHealthPort,
  ) {}

  status() {
    return {
      status: 'ok' as const,
      service: this.config.get<string>('app.name', 'AI Pilot API'),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const durableStorageRequired = this.config.get<boolean>(
      'objectStorage.durablePrivateStorageRequired',
      false,
    );
    const [database, objectStorage] = await Promise.all([
      this.database.status(),
      durableStorageRequired
        ? (this.objectStorage?.status() ?? Promise.resolve('down' as const))
        : Promise.resolve('disabled' as const),
    ]);
    const production =
      this.config.get<string>('app.nodeEnv', 'development') === 'production';
    const databaseReady =
      database === 'up' || (database === 'disabled' && !production);
    const ready = databaseReady && objectStorage !== 'down';
    return {
      ...this.status(),
      status: ready ? ('ok' as const) : ('error' as const),
      dependencies: { database, objectStorage },
    };
  }
}
