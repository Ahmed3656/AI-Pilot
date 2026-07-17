import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { REQUIRED_PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { AuthenticatedActor } from '../../modules/auth/types/authenticated-actor.type';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required?.length) return true;
    const actor = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedActor }>().user;
    return Boolean(
      actor &&
      required.every((permission) => actor.permissions.includes(permission)),
    );
  }
}
