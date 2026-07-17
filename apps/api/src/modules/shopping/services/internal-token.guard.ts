import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { ContractException } from '../../../core/filters/contract-exception';

@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expected?: string;

  constructor(config: ConfigService) {
    this.expected = config.get<string>('shopping.internalToken') || undefined;
  }

  canActivate(context: ExecutionContext): boolean {
    const supplied = context
      .switchToHttp()
      .getRequest<Request>()
      .header('x-internal-token');
    if (!this.expected || !supplied || !safeEqual(supplied, this.expected)) {
      throw new ContractException(
        'INVALID_INTERNAL_TOKEN',
        401,
        'Invalid internal credentials',
      );
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
