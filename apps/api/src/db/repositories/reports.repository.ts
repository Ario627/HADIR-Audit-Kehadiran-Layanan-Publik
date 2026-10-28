import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ReportCategory, ReportStatus } from '@hadir/contracts';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';
import {
  closureVerifications,
  institutions,
  reportCorroborations,
  reportEvents,
  reports,
  stops,
} from '../schema';
import { canonicalJson } from '../../common/utils/canonical-json';
import type { BboxValue } from '../../common/geo/bbox';

export type StoredReportStatus = NonNullable<typeof reports.$inferInsert['status']>;
export type StoredReportCategory = NonNullable<typeof reports.$inferInsert['category']>;
export type StoredEventKind = NonNullable<typeof reportEvents.$inferInsert['kind']>;
export type StoredActorType = NonNullable<typeof reportEvents.$inferInsert['actorType']>;

export interface ReportRow {
  id: string;
  publicId: string;
  category: StoredReportCategory;
  status: StoredReportStatus;
  moderation: 'pending' | 'approved' | 'rejected' | 'quarantined';
  stopCode: string | null;
  stopName: string | null;
  authorityName: string | null;
  evidenceScore: number;
  evidenceLevel: 'none' | 'indication' | 'strong' | 'field_verified';
  corroborationCount: number;
  text: string;
  createdAt: Date;
  resolvedAt: Date | null;
  deviceHash: string;
}

export interface ReportListFilters {
  category: ReportCategory | null;
  status: ReportStatus | null;
  bbox: BboxValue | null;
  cursor: { createdAt: Date; id: string } | null;
  limit: number;
}

export interface InsertReportValues {
  publicId: string;
  category: StoredReportCategory;
  stopId: string;
  routeId: string | null;
  deviceHash: string;
  deviceDayHash: string;
  clientEventId: string;
  text: string;
  institutionId: string | null;
  contactEmailEnc: Buffer | null;
  contactEmailHash: Buffer | null;
  evidenceScore: number;
  evidenceLevel: ReportRow['evidenceLevel'];
}

export interface EventValues {
  kind: StoredEventKind;
  actorType: StoredActorType;
  actorId: string | null;
  payload: Record<string, unknown>;
  sourceUrl: string | null;
}

export interface EventRecord {
  kind: string;
  actorType: string;
  note: string | null;
  createdAt: Date;
}

const GENESIS_HASH = Buffer.alloc(32);
const MAX_LIST_LIMIT = 100;

const reportSelection = {
  id: reports.id,
  publicId: reports.publicId,
  category: reports.category,
  status: reports.status,
  moderation: reports.moderation,
  stopCode: stops.code,
  stopName: stops.name,
  authorityName: institutions.name,
  evidenceScore: reports.evidenceScore,
  evidenceLevel: reports.evidenceLevel,
  corroborationCount: reports.corroborationCount,
  text: reports.text,
  createdAt: reports.createdAt,
  resolvedAt: reports.resolvedAt,
  deviceHash: reports.deviceHash,
};

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

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function chainHashOf(previous: Buffer, payloadHash: Buffer): Buffer {
  return createHash('sha256').update(previous).update(payloadHash).digest();
}

function clamps(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function evidenceScore(input: {
  hasStop: boolean;
  hasPlanMatch: boolean;
  corroborations: number;
  measurableCategory: boolean;
}): number {
  const base = 0.25;
  const stopBonus = input.hasStop ? 0.15 : 0;
  const planBonus = input.hasPlanMatch ? 0.1 : 0;
  const corroborationBonus = 0.2 * (Math.min(input.corroborations, 4) / 4);
  const measurableBonus = input.measurableCategory ? 0.1 : 0;
  return clamps(
    Math.round((base + stopBonus + planBonus + corroborationBonus + measurableBonus) * 100) / 100,
    0,
    1,
  );
}

function publicFilters(filters: ReportListFilters): SQL {
  const conditions: SQL[] = [
    eq(reports.moderation, 'approved'),
    sql`${reports.status} NOT IN ('rejected', 'draft', 'closed')`,
  ];
  if (filters.category !== null) {
    conditions.push(eq(reports.category, filters.category as StoredReportCategory));
  }
  if (filters.status !== null) {
    conditions.push(eq(reports.status, filters.status as StoredReportStatus));
  }
  if (filters.bbox !== null) {
    conditions.push(
      sql`ST_Intersects(${stops.geom}, ST_SetSRID(ST_MakeEnvelope(${filters.bbox.minLon}, ${filters.bbox.minLat}, ${filters.bbox.maxLon}, ${filters.bbox.maxLat}), 4326)::geography)`,
    );
  }
  if (filters.cursor !== null) {
    conditions.push(
      sql`(${reports.createdAt}, ${reports.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`,
    );
  }
  return and(...conditions) ?? sql`false`;
}

function baseQuery(db: Database | Transaction) {
  return db
    .select(reportSelection)
    .from(reports)
    .innerJoin(stops, eq(reports.stopId, stops.id))
    .leftJoin(institutions, eq(institutions.id, reports.institutionId));
}

@Injectable()
export class ReportsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findStopByCode(tx: Transaction, code: string): Promise<{
    id: string;
    code: string;
    name: string;
    status: 'active' | 'inactive' | 'moved' | 'planned';
    cityId: string;
  } | null> {
    const result = await tx.execute(sql`
      SELECT id, code, name, status::text AS status, city_id
      FROM stops WHERE code = ${code} LIMIT 1
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    if (id === null) {
      return null;
    }
    return {
      id,
      code: typeof row.code === 'string' ? row.code : code,
      name: typeof row.name === 'string' ? row.name : '',
      status: (typeof row.status === 'string' ? row.status : 'inactive') as
        | 'active'
        | 'inactive'
        | 'moved'
        | 'planned',
      cityId: typeof row.city_id === 'string' ? row.city_id : '',
    };
  }

  async findAuthorityForStop(tx: Transaction, stopId: string): Promise<string | null> {
    const result = await tx.execute(sql`
      SELECT am.institution_id
      FROM stops s
      INNER JOIN authority_map am
        ON am.city_id = s.city_id AND am.asset_kind = 'stop' AND am.asset_ref = s.code
      WHERE s.id = ${stopId}
      ORDER BY am.verified DESC
      LIMIT 1
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return typeof row.institution_id === 'string' ? row.institution_id : null;
  }

  async findSessionVerdict(tx: Transaction, sessionId: string): Promise<string | null> {
    const result = await tx.execute(sql`
      SELECT verdict::text AS verdict FROM triage_sessions WHERE id = ${sessionId} LIMIT 1
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return typeof row.verdict === 'string' ? row.verdict : null;
  }

  async insertReport(tx: Transaction, values: InsertReportValues): Promise<ReportRow> {
    const inserted = await tx
      .insert(reports)
      .values({
        publicId: values.publicId,
        category: values.category,
        stopId: values.stopId,
        routeId: values.routeId,
        deviceHash: values.deviceHash,
        deviceDayHash: values.deviceDayHash,
        clientEventId: values.clientEventId,
        text: values.text,
        institutionId: values.institutionId,
        contactEmailEnc: values.contactEmailEnc,
        contactEmailHash: values.contactEmailHash,
        evidenceScore: values.evidenceScore,
        evidenceLevel: values.evidenceLevel,
      })
      .returning({ id: reports.id });
    const row = inserted[0];
    if (row === undefined) {
      throw new Error('Laporan gagal dibuat.');
    }
    const created = await this.findByIdForDevice(tx, row.id, values.deviceHash);
    if (created === null) {
      throw new Error('Laporan yang baru dibuat tidak dapat dibaca ulang.');
    }
    return created;
  }

  async appendEvent(tx: Transaction, reportId: string, values: EventValues): Promise<number> {
    await tx.execute(sql`SELECT id FROM reports WHERE id = ${reportId} FOR UPDATE`);
    const last = await tx.execute(sql`
      SELECT seq, chain_hash FROM report_events
      WHERE report_id = ${reportId}
      ORDER BY seq DESC
      LIMIT 1
    `);
    const previous = (last.rows[0] ?? {}) as Record<string, unknown>;
    const previousSeq = toNumber(previous.seq);
    const previousHash =
      previous.chain_hash instanceof Buffer ? previous.chain_hash : GENESIS_HASH;
    const seq = previousSeq === null ? 1 : previousSeq + 1;
    const payloadHash = sha256(canonicalJson(values.payload));
    const chainHash = chainHashOf(previousHash, payloadHash);
    await tx.insert(reportEvents).values({
      reportId,
      seq,
      kind: values.kind,
      actorType: values.actorType,
      actorId: values.actorId,
      payload: values.payload,
      sourceUrl: values.sourceUrl,
      prevHash: previousHash,
      payloadHash,
      chainHash,
    });
    return seq;
  }

  async addCorroboration(
    tx: Transaction,
    reportId: string,
    deviceHash: string,
    note: string | null,
  ): Promise<{ inserted: boolean; count: number }> {
    const inserted = await tx
      .insert(reportCorroborations)
      .values({ reportId, deviceHash, note })
      .onConflictDoNothing()
      .returning({ reportId: reportCorroborations.reportId });
    if (inserted.length === 0) {
      const current = await this.readCorroborationCount(tx, reportId);
      return { inserted: false, count: current };
    }
    const updated = await tx
      .update(reports)
      .set({ corroborationCount: sql`${reports.corroborationCount} + 1` })
      .where(eq(reports.id, reportId))
      .returning({ corroborationCount: reports.corroborationCount });
    const row = updated[0];
    return { inserted: true, count: row?.corroborationCount ?? 0 };
  }

  async readCorroborationCount(tx: Transaction, reportId: string): Promise<number> {
    const rows = await tx
      .select({ count: reports.corroborationCount })
      .from(reports)
      .where(eq(reports.id, reportId))
      .limit(1);
    return rows[0]?.count ?? 0;
  }

  async findByPublicIdForDevice(
    publicId: string,
    deviceHash: string,
  ): Promise<ReportRow | null> {
    const rows = await baseQuery(this.db)
      .where(and(eq(reports.publicId, publicId), eq(reports.deviceHash, deviceHash)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPublicByPublicId(
    executor: Database | Transaction,
    publicId: string,
  ): Promise<ReportRow | null> {
    const rows = await baseQuery(executor)
      .where(
        and(
          eq(reports.publicId, publicId),
          eq(reports.moderation, 'approved'),
          sql`${reports.status} NOT IN ('rejected', 'draft')`,
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByIdForDevice(
    tx: Transaction,
    id: string,
    deviceHash: string,
  ): Promise<ReportRow | null> {
    const rows = await baseQuery(tx)
      .where(and(eq(reports.id, id), eq(reports.deviceHash, deviceHash)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPublic(
    executor: Database | Transaction,
    filters: ReportListFilters,
  ): Promise<{ items: ReportRow[]; hasMore: boolean }> {
    const rows = await baseQuery(executor)
      .where(publicFilters(filters))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(Math.min(filters.limit, MAX_LIST_LIMIT) + 1);
    const hasMore = rows.length > filters.limit;
    return { items: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  }

  async listForDevice(
    executor: Database | Transaction,
    deviceHash: string,
    limit: number,
    cursor: { createdAt: Date; id: string } | null,
  ): Promise<{ items: ReportRow[]; hasMore: boolean }> {
    const conditions: SQL[] = [eq(reports.deviceHash, deviceHash)];
    if (cursor !== null) {
      conditions.push(
        sql`(${reports.createdAt}, ${reports.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
    }
    const rows = await baseQuery(executor)
      .where(and(...conditions))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(Math.min(limit, MAX_LIST_LIMIT) + 1);
    const hasMore = rows.length > limit;
    return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
  }

  async listEvents(reportId: string): Promise<EventRecord[]> {
    const rows = await this.db
      .select({
        kind: reportEvents.kind,
        actorType: reportEvents.actorType,
        payload: reportEvents.payload,
        createdAt: reportEvents.createdAt,
      })
      .from(reportEvents)
      .where(eq(reportEvents.reportId, reportId))
      .orderBy(asc(reportEvents.seq));
    return rows.map((row) => {
      const note = row.payload.note;
      return {
        kind: row.kind,
        actorType: row.actorType,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        createdAt: row.createdAt,
      };
    });
  }

  async findParticipation(
    tx: Transaction,
    reportId: string,
    deviceHash: string,
  ): Promise<{ reporter: boolean; corroborator: boolean }> {
    const result = await tx.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM reports WHERE id = ${reportId} AND device_hash = ${deviceHash}) AS reporter,
        EXISTS (
          SELECT 1 FROM report_corroborations
          WHERE report_id = ${reportId} AND device_hash = ${deviceHash}
        ) AS corroborator
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return { reporter: row.reporter === true, corroborator: row.corroborator === true };
  }

  async recordClosure(
    tx: Transaction,
    input: {
      reportId: string;
      deviceHash: string;
      answer: 'yes' | 'no' | 'partial';
      note: string | null;
      status: StoredReportStatus;
      resolvedAt: Date | null;
    },
  ): Promise<void> {
    await tx
      .insert(closureVerifications)
      .values({
        reportId: input.reportId,
        deviceHash: input.deviceHash,
        answer: input.answer,
        note: input.note,
      })
      .onConflictDoNothing();
    await tx
      .update(reports)
      .set({ status: input.status, resolvedAt: input.resolvedAt })
      .where(eq(reports.id, input.reportId));
  }

  async updateStatus(
    tx: Transaction,
    reportId: string,
    status: StoredReportStatus,
    resolvedAt: Date | null,
  ): Promise<void> {
    await tx
      .update(reports)
      .set({ status, resolvedAt })
      .where(eq(reports.id, reportId));
  }

  async lockReport(
    tx: Transaction,
    reportId: string,
  ): Promise<{ status: StoredReportStatus; deviceHash: string } | null> {
    const rows = await tx
      .select({ status: reports.status, deviceHash: reports.deviceHash })
      .from(reports)
      .where(eq(reports.id, reportId))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async findReportIdByPublicId(tx: Transaction, publicId: string): Promise<string | null> {
    const rows = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(eq(reports.publicId, publicId))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async findReportIdInInstitution(
    tx: Transaction,
    publicId: string,
    institutionId: string,
  ): Promise<string | null> {
    const rows = await tx
      .select({ id: reports.id })
      .from(reports)
      .where(and(eq(reports.publicId, publicId), eq(reports.institutionId, institutionId)))
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async lockReportInInstitution(
    tx: Transaction,
    reportId: string,
    institutionId: string,
  ): Promise<{ status: StoredReportStatus; deviceHash: string } | null> {
    const rows = await tx
      .select({ status: reports.status, deviceHash: reports.deviceHash })
      .from(reports)
      .where(and(eq(reports.id, reportId), eq(reports.institutionId, institutionId)))
      .for('update')
      .limit(1);
    return rows[0] ?? null;
  }

  async listForInstitution(
    executor: Database | Transaction,
    institutionId: string,
    filters: ReportListFilters,
  ): Promise<{ items: ReportRow[]; hasMore: boolean }> {
    const conditions: SQL[] = [eq(reports.institutionId, institutionId)];
    if (filters.category !== null) {
      conditions.push(eq(reports.category, filters.category as StoredReportCategory));
    }
    if (filters.status !== null) {
      conditions.push(eq(reports.status, filters.status as StoredReportStatus));
    }
    if (filters.cursor !== null) {
      conditions.push(
        sql`(${reports.createdAt}, ${reports.id}) < (${filters.cursor.createdAt}, ${filters.cursor.id})`,
      );
    }
    const rows = await baseQuery(executor)
      .where(and(...conditions))
      .orderBy(desc(reports.createdAt), desc(reports.id))
      .limit(Math.min(filters.limit, MAX_LIST_LIMIT) + 1);
    const hasMore = rows.length > filters.limit;
    return { items: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  }

  async findInInstitution(
    executor: Database | Transaction,
    publicId: string,
    institutionId: string,
  ): Promise<ReportRow | null> {
    const rows = await baseQuery(executor)
      .where(and(eq(reports.publicId, publicId), eq(reports.institutionId, institutionId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listEventsFor(executor: Database | Transaction, reportId: string): Promise<EventRecord[]> {
    const rows = await executor
      .select({
        kind: reportEvents.kind,
        actorType: reportEvents.actorType,
        payload: reportEvents.payload,
        createdAt: reportEvents.createdAt,
      })
      .from(reportEvents)
      .where(eq(reportEvents.reportId, reportId))
      .orderBy(asc(reportEvents.seq));
    return rows.map((row) => {
      const note = row.payload.note;
      return {
        kind: row.kind,
        actorType: row.actorType,
        note: typeof note === 'string' ? note.slice(0, 500) : null,
        createdAt: row.createdAt,
      };
    });
  }
}
