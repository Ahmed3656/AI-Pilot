import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseHealthService {
  private static readonly REQUIRED_TABLES = [
    'shopping_runs',
    'shopping_merchant_attempts',
    'shopping_normalized_offers',
    'shopping_coupon_attempts',
    'shopping_run_approvals',
    'shopping_run_events',
    'shopping_evidence_artifacts',
    'shopping_control_leases',
    'shopping_idempotency_records',
  ];
  constructor(
    private readonly config: ConfigService,
    @Optional() @InjectDataSource() private readonly dataSource?: DataSource,
  ) {}

  async status(): Promise<'disabled' | 'up' | 'down'> {
    if (!this.config.get<boolean>('database.enabled', false)) return 'disabled';
    if (!this.dataSource?.isInitialized) return 'down';
    try {
      const rows = await this.dataSource.query<
        Array<{ name: string; relation: string | null }>
      >(
        `SELECT name, to_regclass('public.' || name) AS relation
         FROM unnest($1::text[]) AS name`,
        [DatabaseHealthService.REQUIRED_TABLES],
      );
      return rows.length === DatabaseHealthService.REQUIRED_TABLES.length &&
        rows.every((row) => row.relation)
        ? 'up'
        : 'down';
    } catch {
      return 'down';
    }
  }
}
