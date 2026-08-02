import { DynamicModule, Module, Provider } from '@nestjs/common';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditRecord } from './entities/audit-record.entity';
import {
  AUDIT_REPOSITORY,
  InMemoryAuditRepository,
  TypeormAuditRepository,
} from './repositories/audit.repository';
import { AuditRequestHelper } from './audit-request.helper';
import { AuditService } from './audit.service';

export interface AuditModuleOptions {
  databaseEnabled: boolean;
}

@Module({})
export class AuditModule {
  static register(options: AuditModuleOptions): DynamicModule {
    const auditRepositoryProvider: Provider = options.databaseEnabled
      ? {
          provide: AUDIT_REPOSITORY,
          useFactory: (records: Repository<AuditRecord>) =>
            new TypeormAuditRepository(records),
          inject: [getRepositoryToken(AuditRecord)],
        }
      : { provide: AUDIT_REPOSITORY, useClass: InMemoryAuditRepository };

    return {
      module: AuditModule,
      imports: options.databaseEnabled
        ? [TypeOrmModule.forFeature([AuditRecord])]
        : [],
      providers: [auditRepositoryProvider, AuditRequestHelper, AuditService],
      exports: [AuditService, AuditRequestHelper, AUDIT_REPOSITORY],
    };
  }
}
