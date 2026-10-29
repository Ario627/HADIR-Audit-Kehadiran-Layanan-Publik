import { z } from 'zod';
import { RequestId } from './common';

export const ErrorCode = z.enum([
  'BAD_REQUEST',
  'MALFORMED_JSON',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CSRF_MISSING',
  'CSRF_INVALID',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'EPISODE_ALREADY_ACTIVE',
  'IDEMPOTENCY_CONFLICT',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_TRANSITION',
  'STOP_INACTIVE',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'VALIDATION_FAILED',
  'QR_INVALID',
  'QR_EXPIRED',
  'OUTCOME_INVALID',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'ESTIMATOR_UNAVAILABLE',
  'CONNECTOR_UNAVAILABLE',
  'SERVICE_UNAVAILABLE',
]);

export const FieldError = z.object({
  field: z.string().min(1).max(200),
  code: z.string().min(1).max(80),
  message: z.string().min(1).max(500),
});

export const ProblemDetails = z.object({
  type: z.url(),
  title: z.string().min(1).max(200),
  status: z.number().int().min(400).max(599),
  detail: z.string().max(1000).optional(),
  instance: z.string().max(500).optional(),
  code: ErrorCode,
  requestId: RequestId,
  errors: z.array(FieldError).max(50).optional(),
});

export type ErrorCode = z.infer<typeof ErrorCode>;
export type FieldError = z.infer<typeof FieldError>;
export type ProblemDetails = z.infer<typeof ProblemDetails>;