import { Module, Provider } from '@nestjs/common';
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

const databaseEnabled = process.env.DATABASE_ENABLED === 'true';

const auditRepositoryProvider: Provider = databaseEnabled
  ? {
      provide: AUDIT_REPOSITORY,
      useFactory: (records: Repository<AuditRecord>) =>
        new TypeormAuditRepository(records),
      inject: [getRepositoryToken(AuditRecord)],
    }
  : { provide: AUDIT_REPOSITORY, useClass: InMemoryAuditRepository };

@Module({
  imports: [
    ...(databaseEnabled ? [TypeOrmModule.forFeature([AuditRecord])] : []),
  ],
  providers: [auditRepositoryProvider, AuditRequestHelper, AuditService],
  exports: [AuditService, AuditRequestHelper, AUDIT_REPOSITORY],
})
export class AuditModule {}
