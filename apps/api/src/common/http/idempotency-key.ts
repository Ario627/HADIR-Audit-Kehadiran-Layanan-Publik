import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { IdempotencyKey } from '@hadir/contracts';
import { AppError } from '../errors/app-error';
import { canonicalJson } from '../utils/canonical-json';

export function idempotencyKeyOf(request: Request): string {
  const raw = request.header('idempotency-key');
  if (raw === undefined) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', {
      detail: 'Header Idempotency-Key wajib diisi.',
    });
  }
  const parsed = IdempotencyKey.safeParse(raw.trim());
  if (!parsed.success) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', {
      detail: 'Idempotency-Key harus UUID v7.',
    });
  }
  return parsed.data;
}

export function idempotencyHash(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(value)).digest();
}