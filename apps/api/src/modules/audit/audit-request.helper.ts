import { Injectable } from '@nestjs/common';
import { RequestContextService } from '../../core/request-context/request-context.service';
import { AuthenticatedActor } from '../auth/types/authenticated-actor.type';
import { AuditActorType } from './entities/audit-record.entity';

export interface AuditRequestActor {
  actorType: AuditActorType;
  actorId: string;
  requestId: string;
}

@Injectable()
export class AuditRequestHelper {
  constructor(private readonly requestContext: RequestContextService) {}

  fromAuthenticatedActor(
    actor: Pick<AuthenticatedActor, 'id'>,
  ): AuditRequestActor {
    const requestId = this.requestContext.requestId;
    if (!requestId) {
      throw new Error('AUDIT_REQUEST_CONTEXT_REQUIRED');
    }
    return { actorType: 'principal', actorId: actor.id, requestId };
  }

  fromSystem(actorId: string, requestId: string): AuditRequestActor {
    return { actorType: 'system', actorId, requestId };
  }
}
