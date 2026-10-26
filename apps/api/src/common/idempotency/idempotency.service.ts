import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error';
import { canonicalJson } from '../utils/canonical-json';
import { withTransaction, type Transaction } from '../../db/client';
import { IdempotencyRepository } from './idempotency.repository';

export interface IdempotencyInput {
  scope: string;
  key: string;
  requestHash: Buffer;
  ttlMs: number;
}

export interface IdempotencyContext {
  requestId?: string;
  deviceHash?: string;
}

export interface IdempotentWorkResult<T> {
  status: number;
  body: T;
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

const SCOPE_PATTERN = /^[a-z][a-z0-9._-]{2,79}$/;
const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const MIN_TTL_MS = 60_000;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function assertInput(input: IdempotencyInput): void {
  if (!SCOPE_PATTERN.test(input.scope)) {
    throw new Error('Scope idempotensi tidak valid.');
  }
  if (!KEY_PATTERN.test(input.key)) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', {
      detail: 'Idempotency-Key tidak valid.',
    });
  }
  if (!Buffer.isBuffer(input.requestHash) || input.requestHash.length !== 32) {
    throw new Error('Request hash idempotensi harus SHA-256 32 byte.');
  }
  if (input.ttlMs < MIN_TTL_MS || input.ttlMs > MAX_TTL_MS) {
    throw new Error('TTL idempotensi di luar rentang yang diizinkan.');
  }
}

function assertStatus(status: number): void {
  if (!Number.isInteger(status) || status < 100 || status > 599) {
    throw new Error('Status idempotensi harus 100 sampai 599.');
  }
}

function sameHash(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && left.equals(right);
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRepository) {}

  async execute<T>(
    input: IdempotencyInput,
    work: (tx: Transaction) => Promise<IdempotentWorkResult<T>>,
    context: IdempotencyContext = {},
  ): Promise<IdempotentResult<T>> {
    assertInput(input);

    return withTransaction(async (tx) => {
      const reserved = await this.repository.reserve(tx, {
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        expiresAt: new Date(Date.now() + input.ttlMs),
      });

      if (reserved !== null) {
        const result = await work(tx);
        assertStatus(result.status);
        canonicalJson(result.body);
        await this.repository.complete(
          tx,
          input.scope,
          input.key,
          result.status,
          result.body as Record<string, unknown>,
        );
        return { status: result.status, body: result.body, replayed: false };
      }

      const existing = await this.repository.find(tx, input.scope, input.key);
      if (existing === null) {
        throw new AppError('INTERNAL_ERROR', {
          detail: 'Reservasi idempotensi tidak ditemukan.',
        });
      }
      if (!sameHash(existing.requestHash, input.requestHash)) {
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          detail: 'Idempotency-Key sudah dipakai untuk body yang berbeda.',
        });
      }
      if (existing.responseStatus === 0) {
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          detail: 'Permintaan dengan kunci ini sedang diproses.',
        });
      }
      if (existing.expiresAt.getTime() <= Date.now()) {
        throw new AppError('IDEMPOTENCY_CONFLICT', {
          detail: 'Idempotency-Key sudah kedaluwarsa. Gunakan kunci baru.',
        });
      }
      return {
        status: existing.responseStatus,
        body: existing.responseBody as T,
        replayed: true,
      };
    }, context);
  }
}