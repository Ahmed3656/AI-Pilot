import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { PerformanceTracker } from '../core/observability/performance-tracker';

const INSTRUMENTED = Symbol('ai-pilot-query-runner-instrumented');

@Injectable()
export class TypeormPerformanceService implements OnModuleInit {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tracker: PerformanceTracker,
  ) {}

  onModuleInit(): void {
    const original = this.dataSource.createQueryRunner.bind(this.dataSource);
    this.dataSource.createQueryRunner = (...args): QueryRunner => {
      const queryRunner = original(...args);
      const marked = queryRunner as QueryRunner & { [INSTRUMENTED]?: boolean };
      if (marked[INSTRUMENTED]) return queryRunner;
      marked[INSTRUMENTED] = true;

      const runQuery = queryRunner.query.bind(queryRunner) as (
        ...queryArgs: unknown[]
      ) => Promise<unknown>;
      queryRunner.query = (async (...queryArgs: unknown[]) => {
        const startedAt = performance.now();
        try {
          return await runQuery(...queryArgs);
        } finally {
          const query = typeof queryArgs[0] === 'string' ? queryArgs[0] : '';
          this.tracker.recordDatabaseQuery(
            query,
            performance.now() - startedAt,
          );
        }
      }) as QueryRunner['query'];
      return queryRunner;
    };
  }
}
