import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseHealthService } from '../../database/database-health.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseHealthService,
  ) {}

  status() {
    return {
      status: 'ok' as const,
      service: this.config.get<string>('app.name', 'AI Pilot API'),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness() {
    const database = await this.database.status();
    return {
      ...this.status(),
      status: database === 'down' ? ('error' as const) : ('ok' as const),
      dependencies: { database },
    };
  }
}
