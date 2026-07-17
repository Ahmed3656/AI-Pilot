import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DatabaseHealthService } from './database-health.service';
import { TypeormPerformanceService } from './typeorm-performance.service';

@Global()
@Module({})
export class DatabaseModule {
  static register(): DynamicModule {
    const databaseEnabled = process.env.DATABASE_ENABLED === 'true';
    const imports = databaseEnabled
      ? [
          TypeOrmModule.forRootAsync({
            inject: [ConfigService],
            useFactory: (config: ConfigService): TypeOrmModuleOptions => ({
              type: 'postgres',
              url: config.getOrThrow<string>('database.url'),
              autoLoadEntities: true,
              synchronize: false,
              logging: false,
              maxQueryExecutionTime: config.get<number>(
                'observability.slowQueryMs',
                100,
              ),
            }),
          }),
        ]
      : [];
    return {
      module: DatabaseModule,
      imports,
      providers: [
        DatabaseHealthService,
        ...(databaseEnabled ? [TypeormPerformanceService] : []),
      ],
      exports: [DatabaseHealthService],
    };
  }
}
