import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService {
  constructor(
    private readonly config: ConfigService,
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  async status(): Promise<'disabled' | 'up' | 'down'> {
    if (!this.config.get<boolean>('database.enabled', false)) return 'disabled';
    if (!this.dataSource?.isInitialized) return 'down';
    try {
      await this.dataSource.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }
}
