import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError } from '../shared/errors';

/** Error responses in RFC 9457 (Problem Details) format. Never leaks a stack trace. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let title = 'Internal error';
    let detail: unknown = 'Unexpected error';
    let code: string | undefined;

    if (exception instanceof DomainError) {
      status = 422;
      title = 'Business rule violated';
      detail = exception.message;
      code = exception.code;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      title = exception.name;
      detail = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? body);
    } else {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title, status, detail, ...(code ? { code } : {}) });
  }
}
