import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { Transaction } from '../../db/client';
import { idempotencyKeys } from '../../db/schema';

export interface IdempotencyRecord {
  scope: string;
  key: string;
  requestHash: Buffer;
  responseStatus: number;
  responseBody: Record<string, unknown>;
  expiresAt: Date;
}

export interface ReserveIdempotencyInput {
  scope: string;
  key: string;
  requestHash: Buffer;
  expiresAt: Date;
}

@Injectable()
export class IdempotencyRepository {
  async reserve(
    tx: Transaction,
    input: ReserveIdempotencyInput,
  ): Promise<IdempotencyRecord | null> {
    const rows = await tx
      .insert(idempotencyKeys)
      .values({
        scope: input.scope,
        key: input.key,
        requestHash: input.requestHash,
        responseStatus: 0,
        responseBody: {},
        expiresAt: input.expiresAt,
      })
      .onConflictDoNothing()
      .returning();
    return rows[0] ?? null;
  }

  async find(
    tx: Transaction,
    scope: string,
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const rows = await tx
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .limit(1);
    return rows[0] ?? null;
  }

  async complete(
    tx: Transaction,
    scope: string,
    key: string,
    status: number,
    body: Record<string, unknown>,
  ): Promise<void> {
    const updated = await tx
      .update(idempotencyKeys)
      .set({
        responseStatus: status,
        responseBody: body,
      })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)))
      .returning({ key: idempotencyKeys.key });
    if (updated.length !== 1) {
      throw new Error('Reservasi idempotensi hilang saat menyimpan respons.');
    }
  }
}