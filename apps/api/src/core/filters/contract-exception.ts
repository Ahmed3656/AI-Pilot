import { HttpException } from '@nestjs/common';

export interface ErrorDetail {
  field: string | null;
  code: string;
  message: string;
}

export class ContractException extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message, status);
  }
}
