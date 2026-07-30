import { HttpException } from '@nestjs/common';

export interface ErrorDetail {
  field: string | null;
  code: string;
  message: string;
}

export interface ContractExceptionOptions {
  retryAfterSeconds?: number;
}

export class ContractException extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly details: ErrorDetail[] = [],
    readonly contractOptions: ContractExceptionOptions = {},
  ) {
    super(message, status);
  }
}
