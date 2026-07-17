import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestContextService } from '../request-context/request-context.service';
import { ContractException, ErrorDetail } from './contract-exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const contract = exception instanceof ContractException ? exception : null;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const rawMessage =
      typeof exceptionResponse === 'string'
        ? exceptionResponse
        : typeof exceptionResponse === 'object' &&
            exceptionResponse !== null &&
            'message' in exceptionResponse
          ? (exceptionResponse as { message: string | string[] }).message
          : status === 500
            ? 'Internal server error'
            : 'Request failed';
    const validationMessages = Array.isArray(rawMessage) ? rawMessage : [];
    const message = contract
      ? contract.message
      : validationMessages.length
        ? 'Request validation failed'
        : sanitizeMessage(rawMessage);
    const details: ErrorDetail[] = contract
      ? contract.details
      : validationMessages.map((item) => ({
          field: null,
          code: 'VALIDATION_ERROR',
          message: sanitizeMessage(item),
        }));

    response
      .status(status)
      .type('application/json')
      .json({
        error: {
          code: contract?.code ?? defaultCode(status),
          message,
          status,
          requestId: this.requestContext.requestId ?? 'unknown',
          timestamp: new Date().toISOString(),
          details,
        },
      });
  }
}

function defaultCode(status: number): string {
  const codes: Record<number, string> = {
    400: 'VALIDATION_ERROR',
    401: 'UNAUTHENTICATED',
    403: 'RUN_ACCESS_DENIED',
    404: 'RUN_NOT_FOUND',
    409: 'INVALID_RUN_TRANSITION',
    410: 'ADDRESS_GRANT_EXPIRED',
    429: 'RATE_LIMITED',
    502: 'AI_SERVICE_UNAVAILABLE',
    503: 'DEPENDENCY_UNAVAILABLE',
  };
  return codes[status] ?? 'INTERNAL_ERROR';
}

function sanitizeMessage(value: unknown): string {
  if (typeof value !== 'string') return 'Request failed';
  return value
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .slice(0, 300);
}
