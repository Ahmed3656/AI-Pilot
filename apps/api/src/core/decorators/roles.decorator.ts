import { SetMetadata } from '@nestjs/common';

export const REQUIRED_ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: string[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);
