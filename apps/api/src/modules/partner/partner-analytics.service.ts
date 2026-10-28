import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PartnerAnalytics, PartnerAnalyticsQuery } from '@hadir/contracts';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { Database, Transaction } from '../../db/client';
import { DATABASE } from '../../db/db.module';

export const K_THRESHOLD = 5;
export const MIN_MEDIAN_SAMPLE = 10;
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 180;

export interface AnalyticsBucketRow {
  key: string;
  count: number;
}

export interface AnalyticsAggregate {
  total: number;
  byStatus: AnalyticsBucketRow[];
  byCategory: AnalyticsBucketRow[];
  medianFirstResponseHours: number | null;
  medianResolutionHours: number | null;
  claimedResolvedCount: number;
  disputedCount: number;
  corroboratedCount: number;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampWindow(query: PartnerAnalyticsQuery, now: Date): { start: Date; end: Date } {
  const end = query.to === undefined ? now : new Date(query.to);
  const start =
    query.from === undefined
      ? new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000)
      : new Date(query.from);
  const maxSpan = MAX_WINDOW_DAYS * 86_400_000;
  if (end.getTime() - start.getTime() > maxSpan) {
    return { start: new Date(end.getTime() - maxSpan), end };
  }
  return { start, end };
}

export function toPartnerAnalytics(
  aggregate: AnalyticsAggregate,
  window: { start: Date; end: Date },
  now: Date,
): PartnerAnalytics {
  const total = aggregate.total;
  const suppressed = total > 0 && total < K_THRESHOLD;
  const safeTotal = total === 0 || suppressed ? null : total;
  const medianAllowed = total >= MIN_MEDIAN_SAMPLE;
  const ratio = (value: number): number | null =>
    total === 0 || suppressed ? null : Math.round((value / total) * 1000) / 1000;
  const bucket = (row: AnalyticsBucketRow): { key: string; count: number | null; suppressed: boolean } => ({
    key: row.key,
    count: row.count < K_THRESHOLD ? null : row.count,
    suppressed: row.count < K_THRESHOLD,
  });

  return {
    window: {
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      days: Math.max(1, Math.ceil((window.end.getTime() - window.start.getTime()) / 86_400_000)),
    },
    totalReports: safeTotal,
    totalSuppressed: suppressed,
    byStatus: aggregate.byStatus.map(bucket),
    byCategory: aggregate.byCategory.map(bucket),
    medianFirstResponseHours: medianAllowed
      ? round(aggregate.medianFirstResponseHours)
      : null,
    medianResolutionHours: medianAllowed
      ? round(aggregate.medianResolutionHours)
      : null,
    claimedResolvedRate: ratio(aggregate.claimedResolvedCount),
    disputedRate: ratio(aggregate.disputedCount),
    corroborationRate: ratio(aggregate.corroboratedCount),
    kThreshold: K_THRESHOLD,
    generatedAt: now.toISOString(),
  };
}

function round(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}

@Injectable()
export class PartnerAnalyticsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async compute(
    query: PartnerAnalyticsQuery,
    session: PartnerSession,
    now: Date = new Date(),
  ): Promise<PartnerAnalytics> {
    const window = clampWindow(query, now);
    const aggregate = await this.aggregate(this.db, session.institutionId, window);
    return toPartnerAnalytics(aggregate, window, now);
  }

  private async aggregate(
    executor: Database | Transaction,
    institutionId: string,
    window: { start: Date; end: Date },
  ): Promise<AnalyticsAggregate> {
    const totals = await executor.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE status IN ('claimed_resolved', 'verified_resolved'))::int AS claimed,
        count(*) FILTER (WHERE status = 'disputed')::int AS disputed,
        count(*) FILTER (WHERE corroboration_count > 0)::int AS corroborated,
        percentile_cont(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600.0
        ) AS median_resolution_hours
      FROM reports
      WHERE institution_id = ${institutionId}
        AND created_at >= ${window.start}
        AND created_at <= ${window.end}
    `);
    const totalRow = (totals.rows[0] ?? {}) as Record<string, unknown>;

    const byStatus = await executor.execute(sql`
      SELECT status::text AS key, count(*)::int AS total
      FROM reports
      WHERE institution_id = ${institutionId}
        AND created_at >= ${window.start}
        AND created_at <= ${window.end}
      GROUP BY status
      ORDER BY total DESC, key ASC
    `);

    const byCategory = await executor.execute(sql`
      SELECT category::text AS key, count(*)::int AS total
      FROM reports
      WHERE institution_id = ${institutionId}
        AND created_at >= ${window.start}
        AND created_at <= ${window.end}
      GROUP BY category
      ORDER BY total DESC, key ASC
    `);

    const firstResponse = await executor.execute(sql`
      WITH first_event AS (
        SELECT r.id AS report_id, min(e.created_at) AS responded_at
        FROM reports r
        JOIN report_events e ON e.report_id = r.id
        WHERE r.institution_id = ${institutionId}
          AND r.created_at >= ${window.start}
          AND r.created_at <= ${window.end}
          AND e.kind IN (
            'acknowledged', 'info_requested', 'scheduled', 'responded',
            'claimed_resolved', 'rejected'
          )
        GROUP BY r.id
      )
      SELECT percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (f.responded_at - r.created_at)) / 3600.0
      ) AS median_hours
      FROM first_event f
      JOIN reports r ON r.id = f.report_id
    `);
    const responseRow = (firstResponse.rows[0] ?? {}) as Record<string, unknown>;

    const mapBuckets = (rows: readonly unknown[]): AnalyticsBucketRow[] =>
      rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          key: typeof record.key === 'string' ? record.key : 'unknown',
          count: asNumber(record.total) ?? 0,
        };
      });

    return {
      total: asNumber(totalRow.total) ?? 0,
      byStatus: mapBuckets(byStatus.rows),
      byCategory: mapBuckets(byCategory.rows),
      medianFirstResponseHours: asNumber(responseRow.median_hours),
      medianResolutionHours: asNumber(totalRow.median_resolution_hours),
      claimedResolvedCount: asNumber(totalRow.claimed) ?? 0,
      disputedCount: asNumber(totalRow.disputed) ?? 0,
      corroboratedCount: asNumber(totalRow.corroborated) ?? 0,
    };
  }
}
