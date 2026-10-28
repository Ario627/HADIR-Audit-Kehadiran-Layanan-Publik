import { Inject, Injectable } from '@nestjs/common';
import type { ReportCategory } from '@hadir/contracts';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';
import { triageSessions } from '../schema';

export interface EvidenceRow {
  id: string;
  claim: string;
  tier: 'T1' | 'T2' | 'T3' | 'T4';
  sourceUrl: string | null;
  retrievedAt: Date;
  matchScore: number | null;
  reportPublicId: string | null;
}

export interface AuthorityRow {
  institutionId: string;
  institutionName: string;
}

export type StoredVerdict = NonNullable<typeof triageSessions.$inferInsert['verdict']>;

export interface SessionValues {
  deviceHash: string;
  deviceDayHash: string;
  clientEventId: string;
  stopId: string;
  routeId: string | null;
  category: ReportCategory;
  verdict: StoredVerdict;
  evidenceIds: string[];
  rulesVer: string;
  latencyMs: number;
  connectors: Record<string, string>;
}

export interface SessionRecord {
  id: string;
  verdict: string;
  evidenceIds: string[];
  connectors: Record<string, string>;
  latencyMs: number | null;
  createdAt: Date;
}

const DUPLICATE_RADIUS_M = 75;
const EVIDENCE_LIMIT = 20;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapEvidence(raw: Record<string, unknown>): EvidenceRow | null {
  const id = typeof raw.id === 'string' ? raw.id : null;
  const claim = typeof raw.claim === 'string' ? raw.claim : null;
  const tier = typeof raw.tier === 'string' ? raw.tier : null;
  const retrievedAt = raw.retrieved_at;
  if (
    id === null ||
    claim === null ||
    tier === null ||
    !(retrievedAt instanceof Date) ||
    !['T1', 'T2', 'T3', 'T4'].includes(tier)
  ) {
    return null;
  }
  return {
    id,
    claim,
    tier: tier as EvidenceRow['tier'],
    sourceUrl: typeof raw.source_url === 'string' ? raw.source_url : null,
    retrievedAt,
    matchScore: toNumber(raw.match_score),
    reportPublicId:
      typeof raw.report_public_id === 'string' && raw.report_public_id.length > 0
        ? raw.report_public_id
        : null,
  };
}

@Injectable()
export class TriageRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async countDuplicates(
    stopId: string,
    category: ReportCategory,
    windowDays: number,
  ): Promise<number> {
    const result = await this.db.execute(sql`
      SELECT count(*)::int AS total
      FROM reports r
      WHERE r.category = ${category}
        AND r.moderation <> 'rejected'
        AND r.created_at >= now() - make_interval(days => ${windowDays})
        AND r.stop_id IN (
          SELECT s2.id
          FROM stops s2
          WHERE ST_DWithin(
            s2.geom,
            (SELECT geom FROM stops WHERE id = ${stopId}),
            ${DUPLICATE_RADIUS_M}
          )
        )
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return toNumber(row.total) ?? 0;
  }

  async routeServesStop(routeId: string, stopId: string): Promise<boolean> {
    const result = await this.db.execute(sql`
      SELECT 1 AS ok FROM route_stops
      WHERE route_id = ${routeId} AND stop_id = ${stopId}
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async findPlannedEvidence(
    stopCode: string,
    category: ReportCategory,
    routeId: string | null,
  ): Promise<EvidenceRow[]> {
    const result = await this.db.execute(sql`
      SELECT id, claim, tier::text AS tier, source_url, retrieved_at, match_score,
             payload->>'reportPublicId' AS report_public_id
      FROM evidence_items
      WHERE tier IN ('T1', 'T2')
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
        AND (
          payload @> jsonb_build_object('category', ${category}::text)
          OR payload @> jsonb_build_object('stopCode', ${stopCode}::text)
          OR (
            ${routeId}::text IS NOT NULL
            AND payload @> jsonb_build_object('routeId', ${routeId}::text)
          )
        )
      ORDER BY tier ASC, coalesce(match_score, 0) DESC
      LIMIT ${EVIDENCE_LIMIT}
    `);
    const rows: EvidenceRow[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const mapped = mapEvidence(raw);
      if (mapped !== null) {
        rows.push(mapped);
      }
    }
    return rows;
  }

  async findAuthority(stopId: string): Promise<AuthorityRow | null> {
    const result = await this.db.execute(sql`
      SELECT i.id AS institution_id, i.name AS institution_name
      FROM stops s
      INNER JOIN authority_map am
        ON am.city_id = s.city_id AND am.asset_kind = 'stop' AND am.asset_ref = s.code
      INNER JOIN institutions i ON i.id = am.institution_id
      WHERE s.id = ${stopId}
      ORDER BY am.verified DESC, i.created_at ASC
      LIMIT 1
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const institutionId = typeof row.institution_id === 'string' ? row.institution_id : null;
    const institutionName =
      typeof row.institution_name === 'string' ? row.institution_name : null;
    if (institutionId === null || institutionName === null) {
      return null;
    }
    return { institutionId, institutionName };
  }

  async findPilotInstitution(stopId: string): Promise<string | null> {
    const result = await this.db.execute(sql`
      SELECT i.id
      FROM stops s
      INNER JOIN institutions i ON i.city_id = s.city_id
      WHERE s.id = ${stopId} AND i.kind IN ('dinhub', 'dishub')
      ORDER BY i.created_at ASC
      LIMIT 1
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return typeof row.id === 'string' ? row.id : null;
  }

  async insertSession(tx: Transaction, values: SessionValues): Promise<SessionRecord> {
    const rows = await tx
      .insert(triageSessions)
      .values({
        deviceHash: values.deviceHash,
        deviceDayHash: values.deviceDayHash,
        clientEventId: values.clientEventId,
        stopId: values.stopId,
        routeId: values.routeId,
        category: values.category,
        verdict: values.verdict,
        evidenceIds: [...values.evidenceIds],
        rulesVer: values.rulesVer,
        latencyMs: values.latencyMs,
        connectors: values.connectors,
      })
      .returning({
        id: triageSessions.id,
        verdict: triageSessions.verdict,
        evidenceIds: triageSessions.evidenceIds,
        connectors: triageSessions.connectors,
        latencyMs: triageSessions.latencyMs,
        createdAt: triageSessions.createdAt,
      });
    const row = rows[0];
    if (row === undefined) {
      throw new Error('Sesi triase gagal dibuat.');
    }
    return {
      id: row.id,
      verdict: row.verdict,
      evidenceIds: row.evidenceIds,
      connectors: row.connectors,
      latencyMs: row.latencyMs,
      createdAt: row.createdAt,
    };
  }

  async findSessionForDevice(
    id: string,
    deviceHash: string,
  ): Promise<SessionRecord | null> {
    const rows = await this.db
      .select({
        id: triageSessions.id,
        verdict: triageSessions.verdict,
        evidenceIds: triageSessions.evidenceIds,
        connectors: triageSessions.connectors,
        latencyMs: triageSessions.latencyMs,
        createdAt: triageSessions.createdAt,
      })
      .from(triageSessions)
      .where(
        sql`${triageSessions.id} = ${id} AND ${triageSessions.deviceHash} = ${deviceHash}`,
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async attachReport(tx: Transaction, sessionId: string, reportId: string): Promise<void> {
    await tx
      .update(triageSessions)
      .set({ completedReportId: reportId })
      .where(sql`${triageSessions.id} = ${sessionId}`);
  }
}
