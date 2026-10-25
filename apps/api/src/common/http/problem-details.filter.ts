import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  AppError,
  codeForStatus,
  problemType,
  titleForCode,
  type ErrorCode,
  type FieldError,
} from '../errors/app-error';
import { fieldErrorsFromZod } from './zod';

interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: ErrorCode;
  requestId: string;
  errors?: readonly FieldError[];
}

const SAFE_SERVER_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ESTIMATOR_UNAVAILABLE',
  'CONNECTOR_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readMessage(record: Record<string, unknown> | null): string | null {
  const value = record?.message;
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (!Array.isArray(value)) {
    return null;
  }
  const parts = value.filter(
    (item): item is string => typeof item === 'string' && item.length > 0,
  );
  return parts.length > 0 ? parts.join('; ') : null;
}

function readFieldErrors(value: unknown): FieldError[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const errors: FieldError[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const field = readString(record, 'field');
    const code = readString(record, 'code');
    const message = readString(record, 'message');
    if (field && code && message) {
      errors.push({ field, code, message });
    }
  }
  return errors.length > 0 ? errors : null;
}

function isErrorCode(value: string | null): value is ErrorCode {
  return value !== null && /^[A-Z][A-Z0-9_]*$/.test(value);
}

function requestIdOf(request: Request, response: Response): string {
  const locals = response.locals as { requestId?: unknown };
  if (typeof locals.requestId === 'string') {
    return locals.requestId;
  }
  return request.context?.requestId ?? 'unknown';
}

interface ParsedException {
  status: number;
  code: ErrorCode;
  detail: string;
  errors: FieldError[] | null;
  headers: Readonly<Record<string, string>> | null;
  loggedError: unknown;
}

function parseAppError(exception: AppError): ParsedException {
  return {
    status: exception.status,
    code: exception.code,
    detail: exception.detail,
    errors: exception.errors ? [...exception.errors] : null,
    headers: exception.headers,
    loggedError: exception.status >= 500 ? exception : null,
  };
}

function parseZodError(exception: ZodError): ParsedException {
  return {
    status: 422,
    code: 'VALIDATION_FAILED',
    detail: 'Satu atau lebih field tidak valid.',
    errors: fieldErrorsFromZod(exception),
    headers: null,
    loggedError: null,
  };
}

function parseHttpException(exception: HttpException): ParsedException {
  const status = exception.getStatus();
  const body = asRecord(exception.getResponse());
  const bodyCode = readString(body, 'code');
  const candidate = isErrorCode(bodyCode) ? bodyCode : null;
  const fallbackCode = codeForStatus(status);
  const code =
    status >= 500
      ? candidate !== null && SAFE_SERVER_CODES.has(candidate)
        ? candidate
        : 'INTERNAL_ERROR'
      : (candidate ?? fallbackCode);
  const detail =
    status >= 500 && !SAFE_SERVER_CODES.has(code)
      ? 'Permintaan tidak dapat diproses.'
      : (readString(body, 'detail') ?? readMessage(body) ?? titleForCode(code));
  return {
    status,
    code,
    detail,
    errors: readFieldErrors(body?.errors),
    headers: status === 429 ? { 'Retry-After': '60' } : null,
    loggedError: status >= 500 ? exception : null,
  };
}

function parseBodyParserError(exception: unknown): ParsedException | null {
  const record = asRecord(exception);
  if (!record) {
    return null;
  }
  const type = readString(record, 'type');
  if (type === 'entity.parse.failed' || (exception instanceof SyntaxError && record.status === 400)) {
    return {
      status: 400,
      code: 'MALFORMED_JSON',
      detail: 'Body permintaan bukan JSON yang valid.',
      errors: null,
      headers: null,
      loggedError: null,
    };
  }
  if (type === 'entity.too.large') {
    return {
      status: 413,
      code: 'PAYLOAD_TOO_LARGE',
      detail: 'Ukuran body melebihi batas yang diizinkan.',
      errors: null,
      headers: null,
      loggedError: null,
    };
  }
  if (type === 'encoding.unsupported' || type === 'entity.verify.failed') {
    return {
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      detail: 'Encoding body tidak didukung.',
      errors: null,
      headers: null,
      loggedError: null,
    };
  }
  return null;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = requestIdOf(request, response);

    if (response.headersSent) {
      return;
    }

    const parsed =
      exception instanceof AppError
        ? parseAppError(exception)
        : exception instanceof ZodError
          ? parseZodError(exception)
          : exception instanceof HttpException
            ? parseHttpException(exception)
            : (parseBodyParserError(exception) ?? this.parseUnexpected(exception, requestId));

    if (parsed.loggedError !== null) {
      const error = parsed.loggedError instanceof Error ? parsed.loggedError : new Error(String(parsed.loggedError));
      this.logger.error(`${parsed.code} ${request.method} ${request.path} [${requestId}]`, error.stack);
    } else {
      this.logger.debug(`${parsed.code} ${request.method} ${request.path} [${requestId}]`);
    }

    if (parsed.headers) {
      for (const [name, value] of Object.entries(parsed.headers)) {
        response.setHeader(name, value);
      }
    }

    const body: ProblemBody = {
      type: problemType(parsed.code),
      title: titleForCode(parsed.code),
      status: parsed.status,
      detail: parsed.detail,
      instance: request.path,
      code: parsed.code,
      requestId,
      ...(parsed.errors === null ? {} : { errors: parsed.errors }),
    };

    response.setHeader('Cache-Control', 'no-store');
    response.status(parsed.status).type('application/problem+json').json(body);
  }

  private parseUnexpected(exception: unknown, requestId: string): ParsedException {
    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(`INTERNAL_ERROR [${requestId}]`, error.stack);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      detail: 'Permintaan tidak dapat diproses.',
      errors: null,
      headers: null,
      loggedError: null,
    };
  }
}
