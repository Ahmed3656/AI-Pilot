import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expected: string;

  constructor(config: ConfigService) {
    this.expected = config.get<string>(
      'shopping.internalToken',
      'local-internal-token-change-before-production',
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const supplied = context
      .switchToHttp()
      .getRequest<Request>()
      .header('x-internal-token');
    if (!supplied || !safeEqual(supplied, this.expected)) {
      throw new UnauthorizedException('Invalid internal credentials');
    }
    return true;
  }
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
