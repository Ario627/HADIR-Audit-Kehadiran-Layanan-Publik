import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  RetentionDecision,
  RetentionOverride,
  RetentionPlan,
} from '@hadir/domain';
import { actionableDecisions, planRetention } from '@hadir/domain';
import type { Database } from '../client';
import { DATABASE } from '../db.module';

export interface RetentionRunRow {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  rowsRemoved: number;
  datasets: Record<string, unknown>;
  triggeredBy: string;
  errorCode: string | null;
}

export interface RetentionOutcome {
  uploads: number;
  exports: number;
  runs: number;
  total: number;
  failures: string[];
}

const RUN_KEEP = 500;
const RUN_PRUNE_LIMIT = 500;

function asNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error('Kolom waktu tidak valid.');
}

function toRun(row: Record<string, unknown>): RetentionRunRow {
  const datasets = row.datasets;
  return {
    id: asString(row.id, 'id'),
    startedAt: asDate(row.started_at),
    finishedAt:
      row.finished_at === null || row.finished_at === undefined
        ? null
        : asDate(row.finished_at),
    rowsRemoved: asNumber(row.rows_removed),
    datasets:
      datasets !== null && typeof datasets === 'object' && !Array.isArray(datasets)
        ? (datasets as Record<string, unknown>)
        : {},
    triggeredBy: asString(row.triggered_by, 'triggered_by'),
    errorCode: typeof row.error_code === 'string' ? row.error_code : null,
  };
}

@Injectable()
export class RetentionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async loadOverrides(): Promise<RetentionOverride[]> {
    const result = await this.db.execute(sql`
      SELECT dataset, retention_days FROM retention_overrides ORDER BY dataset
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        dataset: asString(record.dataset, 'dataset') as RetentionOverride['dataset'],
        retentionDays: asNumber(record.retention_days),
      };
    });
  }

  async plan(now: Date = new Date()): Promise<RetentionPlan> {
    const overrides = await this.loadOverrides();
    return planRetention({ now: now.toISOString(), overrides });
  }

  async startRun(triggeredBy: 'worker' | 'manual' | 'test'): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO retention_runs (triggered_by) VALUES (${triggeredBy}) RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Retention run gagal dicatat.');
    }
    return asString(row.id, 'id');
  }

  async finishRun(
    runId: string,
    rowsRemoved: number,
    datasets: Record<string, unknown>,
    errorCode: string | null,
  ): Promise<void> {
    await this.db.execute(sql`
      UPDATE retention_runs
      SET finished_at = now(), rows_removed = ${rowsRemoved},
          datasets = ${JSON.stringify(datasets)}::jsonb, error_code = ${errorCode}
      WHERE id = ${runId}
    `);
  }

  async purgeUploads(cutoff: string, limit: number): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT purge_expired_uploads(${cutoff}::timestamptz, ${limit}) AS removed`,
    );
    return asNumber((result.rows[0] as Record<string, unknown> | undefined)?.removed);
  }

  async purgeExports(cutoff: string, limit: number): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT purge_expired_exports(${cutoff}::timestamptz, ${limit}) AS removed`,
    );
    return asNumber((result.rows[0] as Record<string, unknown> | undefined)?.removed);
  }

  async pruneRuns(keep: number, limit: number): Promise<number> {
    const result = await this.db.execute(
      sql`SELECT prune_retention_runs(${keep}, ${limit}) AS removed`,
    );
    return asNumber((result.rows[0] as Record<string, unknown> | undefined)?.removed);
  }

  async recentRuns(limit: number): Promise<RetentionRunRow[]> {
    const result = await this.db.execute(sql`
      SELECT id, started_at, finished_at, rows_removed, datasets, triggered_by, error_code
      FROM retention_runs
      ORDER BY started_at DESC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => toRun(row as Record<string, unknown>));
  }

  async runPlan(
    plan: RetentionPlan,
    triggeredBy: 'worker' | 'manual' | 'test',
    options: { batchSize: number; maxRounds: number } = { batchSize: 500, maxRounds: 20 },
  ): Promise<RetentionOutcome> {
    const runId = await this.startRun(triggeredBy);
    const outcome: RetentionOutcome = { uploads: 0, exports: 0, runs: 0, total: 0, failures: [] };
    const decisions = new Map<RetentionDecision['dataset'], RetentionDecision>(
      actionableDecisions(plan).map((decision) => [decision.dataset, decision]),
    );

    const drain = async (
      label: 'uploads' | 'exports' | 'runs',
      cutoffOf: () => string | null,
      purge: (cutoff: string, limit: number) => Promise<number>,
    ): Promise<void> => {
      let total = 0;
      for (let round = 0; round < options.maxRounds; round += 1) {
        const cutoff = cutoffOf();
        if (cutoff === null) {
          break;
        }
        const removed = await purge(cutoff, options.batchSize);
        total += removed;
        if (removed < options.batchSize) {
          break;
        }
      }
      outcome[label] = total;
      outcome.total += total;
    };

    try {
      await drain(
        'uploads',
        () => decisions.get('uploads.pending')?.cutoff ?? null,
        (cutoff, limit) => this.purgeUploads(cutoff, limit),
      );
    } catch (error) {
      outcome.failures.push(`uploads:${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      await drain(
        'exports',
        () => decisions.get('exports.row')?.cutoff ?? null,
        (cutoff, limit) => this.purgeExports(cutoff, limit),
      );
    } catch (error) {
      outcome.failures.push(`exports:${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      outcome.runs = await this.pruneRuns(RUN_KEEP, RUN_PRUNE_LIMIT);
      outcome.total += outcome.runs;
    } catch (error) {
      outcome.failures.push(`runs:${error instanceof Error ? error.message : String(error)}`);
    }

    await this.finishRun(
      runId,
      outcome.total,
      {
        uploads: outcome.uploads,
        exports: outcome.exports,
        runs: outcome.runs,
        skipped: plan.skipped,
        warnings: plan.warnings,
      },
      outcome.failures.length === 0 ? null : 'PARTIAL_FAILURE',
    );

    return outcome;
  }
}
