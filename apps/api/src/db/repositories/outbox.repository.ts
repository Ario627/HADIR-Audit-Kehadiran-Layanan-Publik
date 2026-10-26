import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';

export interface OutboxJob {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface ClaimOptions {
  batchSize: number;
  leaseSeconds: number;
  maxAttempts: number;
}

export interface OutboxStats {
  pending: number;
  exhausted: number;
  oldestPendingSeconds: number | null;
}

const MAX_BACKOFF_SECONDS = 300;
const MAX_ERROR_LENGTH = 500;

export function backoffSeconds(attempts: number): number {
  if (!Number.isFinite(attempts) || attempts <= 0) {
    return 1;
  }
  return Math.min(MAX_BACKOFF_SECONDS, 2 ** Math.min(attempts, 16));
}

export function isExhausted(attempts: number, maxAttempts: number): boolean {
  return attempts >= maxAttempts;
}

function clampError(error: unknown): string {
  const raw =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return raw.replace(/[\r\n\t]+/g, ' ').slice(0, MAX_ERROR_LENGTH);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function mapJob(raw: Record<string, unknown>): OutboxJob | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const topic = typeof raw.topic === 'string' ? raw.topic : null;
  const payload = raw.payload;
  const attempts = toNumber(raw.attempts);
  if (id === null || topic === null || typeof payload !== 'object' || payload === null) {
    return null;
  }
  return {
    id,
    topic,
    payload: payload as Record<string, unknown>,
    attempts,
  };
}

@Injectable()
export class OutboxRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async claim(options: ClaimOptions): Promise<OutboxJob[]> {
    const result = await this.db.execute(sql`
      WITH ready AS (
        SELECT id FROM outbox
        WHERE processed_at IS NULL
          AND available_at <= now()
          AND attempts < ${options.maxAttempts}
        ORDER BY available_at, created_at
        LIMIT ${options.batchSize}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox o
      SET attempts = o.attempts + 1,
          available_at = now() + make_interval(secs => ${options.leaseSeconds})
      FROM ready
      WHERE o.id = ready.id
      RETURNING o.id, o.topic, o.payload, o.attempts
    `);
    const jobs: OutboxJob[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const job = mapJob(raw);
      if (job !== null) {
        jobs.push(job);
      }
    }
    return jobs;
  }

  async complete(id: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE outbox
      SET processed_at = now(), last_error = NULL
      WHERE id = ${id} AND processed_at IS NULL
    `);
  }

  async fail(id: string, attempts: number, error: unknown): Promise<void> {
    const delay = backoffSeconds(attempts);
    await this.db.execute(sql`
      UPDATE outbox
      SET available_at = now() + make_interval(secs => ${delay}),
          last_error = ${clampError(error)}
      WHERE id = ${id} AND processed_at IS NULL
    `);
  }

  async stats(maxAttempts: number): Promise<OutboxStats> {
    const result = await this.db.execute(sql`
      SELECT
        count(*) FILTER (WHERE processed_at IS NULL AND attempts < ${maxAttempts})::int AS pending,
        count(*) FILTER (WHERE processed_at IS NULL AND attempts >= ${maxAttempts})::int AS exhausted,
        coalesce(
          max(extract(epoch FROM (now() - created_at))) FILTER (WHERE processed_at IS NULL),
          0
        )::int AS oldest
      FROM outbox
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      pending: toNumber(row.pending),
      exhausted: toNumber(row.exhausted),
      oldestPendingSeconds: toNumber(row.oldest),
    };
  }
}