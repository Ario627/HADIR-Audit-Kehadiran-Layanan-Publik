import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  CommitmentKind,
  CommitmentDayScope,
  CommitmentStatus,
  IncidentImpact,
} from '@hadir/contracts';
import type { Database, Transaction } from '../client';

export interface CommitmentRow {
  id: string;
  routeId: string | null;
  stopId: string | null;
  kind: CommitmentKind;
  dayScope: CommitmentDayScope;
  headwayMin: number | null;
  spanStart: string | null;
  spanEnd: string | null;
  sourceDocumentUrl: string;
  sourceDocumentTitle: string | null;
  sourceDocumentVersion: string | null;
  validFrom: string;
  validUntil: string | null;
  status: CommitmentStatus;
  verifiedAt: Date | null;
  institutionName: string;
}

export interface ContextRow {
  id: string;
  kind: string;
  impact: IncidentImpact;
  text: string;
  sourceUrl: string;
  startsAt: Date | null;
  endsAt: Date | null;
  stopId: string | null;
  routeId: string | null;
  acknowledgedAt: Date | null;
  institutionName: string | null;
}

export interface SnapshotRow {
  id: string;
  subjectKind: string;
  subjectRef: string;
  methodVersion: string;
  datasetDigest: Buffer;
  outputDigest: Buffer;
  inputRows: number;
  evidenceLevel: string;
  direction: string;
  warnings: string[];
  provenance: Record<string, unknown>;
  computedAt: Date;
}

export interface CommitmentInsert {
  institutionId: string;
  routeId: string | null;
  stopId: string | null;
  kind: CommitmentKind;
  dayScope: CommitmentDayScope;
  headwayMin: number | null;
  spanStart: string | null;
  spanEnd: string | null;
  sourceDocumentUrl: string;
  sourceDocumentTitle: string | null;
  sourceDocumentVersion: string | null;
  validFrom: string;
  validUntil: string | null;
  notes: string | null;
}

export interface SnapshotInsert {
  subjectKind: 'stop_estimate' | 'route_coverage';
  subjectRef: string;
  methodVersion: string;
  parameters: Record<string, unknown>;
  datasetDigest: Buffer;
  outputDigest: Buffer;
  inputRows: number;
  windowStart: Date;
  windowEnd: Date;
  evidenceLevel: string;
  direction: string;
  warnings: readonly string[];
  provenance: Record<string, unknown>;
}

export interface ContextFilters {
  stopId: string | null;
  routeId: string | null;
  from: Date | null;
  to: Date | null;
  limit: number;
}

export interface ObservationPointRow {
  day: string;
  hour: number;
  deviceDay: string;
}

export interface ObservationFilters {
  stopId: string;
  routeId: string | null;
  start: Date;
  end: Date;
  includeSimulated: boolean;
}

export interface CommitmentFilters {
  routeId: string | null;
  stopId: string | null;
  onDate: string | null;
  dayScope: CommitmentDayScope | null;
  limit: number;
}

const COMMITMENT_COLUMNS = sql`
  id, route_id, stop_id, kind::text AS kind, day_scope::text AS day_scope,
  headway_min::float8 AS headway_min, span_start::text AS span_start,
  span_end::text AS span_end, source_document_url, source_document_title,
  source_document_version, valid_from::text AS valid_from,
  valid_until::text AS valid_until, status::text AS status,
  verified_at, institution_name
`;

const SNAPSHOT_COLUMNS = sql`
  id, subject_kind, subject_ref, method_version, dataset_digest, output_digest,
  input_rows, evidence_level, direction, warnings, provenance, computed_at
`;

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value);
}

function asBuffer(value: unknown, field: string): Buffer {
  if (value instanceof Buffer) {
    return value;
  }
  throw new Error(`Kolom ${field} bukan bytea.`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string');
  }
  return [];
}

function toCommitment(row: Record<string, unknown>): CommitmentRow {
  return {
    id: asString(row.id, 'id'),
    routeId: asNullableString(row.route_id),
    stopId: asNullableString(row.stop_id),
    kind: asString(row.kind, 'kind') as CommitmentKind,
    dayScope: asString(row.day_scope, 'day_scope') as CommitmentDayScope,
    headwayMin: asNumber(row.headway_min),
    spanStart: asNullableString(row.span_start),
    spanEnd: asNullableString(row.span_end),
    sourceDocumentUrl: asString(row.source_document_url, 'source_document_url'),
    sourceDocumentTitle: asNullableString(row.source_document_title),
    sourceDocumentVersion: asNullableString(row.source_document_version),
    validFrom: asString(row.valid_from, 'valid_from'),
    validUntil: asNullableString(row.valid_until),
    status: asString(row.status, 'status') as CommitmentStatus,
    verifiedAt: asNullableDate(row.verified_at),
    institutionName: asNullableString(row.institution_name) ?? 'Instansi tidak tercatat',
  };
}

function toContext(row: Record<string, unknown>): ContextRow {
  return {
    id: asString(row.id, 'id'),
    kind: asString(row.kind, 'kind'),
    impact: asString(row.impact, 'impact') as IncidentImpact,
    text: asString(row.text, 'text'),
    sourceUrl: asString(row.source_url, 'source_url'),
    startsAt: asNullableDate(row.starts_at),
    endsAt: asNullableDate(row.ends_at),
    stopId: asNullableString(row.stop_id),
    routeId: asNullableString(row.route_id),
    acknowledgedAt: asNullableDate(row.acknowledged_at),
    institutionName: asNullableString(row.institution_name),
  };
}

function toSnapshot(row: Record<string, unknown>): SnapshotRow {
  return {
    id: asString(row.id, 'id'),
    subjectKind: asString(row.subject_kind, 'subject_kind'),
    subjectRef: asString(row.subject_ref, 'subject_ref'),
    methodVersion: asString(row.method_version, 'method_version'),
    datasetDigest: asBuffer(row.dataset_digest, 'dataset_digest'),
    outputDigest: asBuffer(row.output_digest, 'output_digest'),
    inputRows: asNumber(row.input_rows) ?? 0,
    evidenceLevel: asString(row.evidence_level, 'evidence_level'),
    direction: asString(row.direction, 'direction'),
    warnings: asStringArray(row.warnings),
    provenance: asRecord(row.provenance),
    computedAt: asDate(row.computed_at),
  };
}

@Injectable()
export class EvidenceRepository {
  async listCommitments(
    executor: Database | Transaction,
    filters: CommitmentFilters,
  ): Promise<CommitmentRow[]> {
    const conditions: SQL[] = [sql`true`];
    if (filters.stopId !== null) {
      conditions.push(sql`(stop_id = ${filters.stopId} OR route_id IS NOT NULL)`);
    }
    if (filters.routeId !== null) {
      conditions.push(sql`(route_id = ${filters.routeId} OR stop_id IS NOT NULL)`);
    }
    if (filters.onDate !== null) {
      conditions.push(sql`
        valid_from <= ${filters.onDate}::date
        AND (valid_until IS NULL OR valid_until >= ${filters.onDate}::date)
      `);
    }
    if (filters.dayScope !== null) {
      conditions.push(sql`day_scope IN ('all', ${filters.dayScope})`);
    }
    const result = await executor.execute(sql`
      SELECT ${COMMITMENT_COLUMNS}
      FROM service_commitments_public
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY stop_id NULLS LAST, valid_from DESC
      LIMIT ${filters.limit}
    `);
    return result.rows.map((row) => toCommitment(row as Record<string, unknown>));
  }

  async findCommitment(
    executor: Database | Transaction,
    id: string,
  ): Promise<CommitmentRow | null> {
    const result = await executor.execute(sql`
      SELECT ${COMMITMENT_COLUMNS}
      FROM service_commitments_public
      WHERE id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toCommitment(row);
  }

  async createCommitment(
    tx: Transaction,
    input: CommitmentInsert,
  ): Promise<CommitmentRow> {
    const result = await tx.execute(sql`
      INSERT INTO service_commitments (
        institution_id, route_id, stop_id, kind, day_scope, headway_min,
        span_start, span_end, source_document_url, source_document_title,
        source_document_version, valid_from, valid_until, notes
      ) VALUES (
        ${input.institutionId}, ${input.routeId}, ${input.stopId}, ${input.kind},
        ${input.dayScope}, ${input.headwayMin}, ${input.spanStart}::time,
        ${input.spanEnd}::time, ${input.sourceDocumentUrl}, ${input.sourceDocumentTitle},
        ${input.sourceDocumentVersion}, ${input.validFrom}::date,
        ${input.validUntil}::date, ${input.notes}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Janji layanan gagal dibuat.');
    }
    const created = await this.findCommitmentRaw(tx, asString(row.id, 'id'));
    if (created === null) {
      throw new Error('Janji layanan yang baru dibuat tidak dapat dibaca ulang.');
    }
    return created;
  }

  async findCommitmentRaw(
    executor: Database | Transaction,
    id: string,
  ): Promise<CommitmentRow | null> {
    const result = await executor.execute(sql`
      SELECT
        c.id, c.route_id, c.stop_id, c.kind::text AS kind, c.day_scope::text AS day_scope,
        c.headway_min::float8 AS headway_min, c.span_start::text AS span_start,
        c.span_end::text AS span_end, c.source_document_url, c.source_document_title,
        c.source_document_version, c.valid_from::text AS valid_from,
        c.valid_until::text AS valid_until, c.status::text AS status,
        c.verified_at, i.name AS institution_name
      FROM service_commitments c
      JOIN institutions i ON i.id = c.institution_id
      WHERE c.id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toCommitment(row);
  }

  async verifyCommitment(
    tx: Transaction,
    id: string,
    adminId: string,
  ): Promise<CommitmentRow | null> {
    const result = await tx.execute(sql`
      UPDATE service_commitments
      SET status = 'verified', verified_by = ${adminId}, verified_at = now()
      WHERE id = ${id} AND status = 'draft'
      RETURNING id
    `);
    if (result.rows.length === 0) {
      return null;
    }
    return this.findCommitmentRaw(tx, id);
  }

  async revokeCommitment(
    tx: Transaction,
    id: string,
    reason: string,
  ): Promise<CommitmentRow | null> {
    const result = await tx.execute(sql`
      UPDATE service_commitments
      SET status = 'revoked', notes = ${reason}
      WHERE id = ${id} AND status IN ('draft', 'verified')
      RETURNING id
    `);
    if (result.rows.length === 0) {
      return null;
    }
    return this.findCommitmentRaw(tx, id);
  }

  async listContext(
    executor: Database | Transaction,
    filters: ContextFilters,
  ): Promise<ContextRow[]> {
    const conditions: SQL[] = [sql`true`];
    if (filters.stopId !== null) {
      conditions.push(sql`(stop_id = ${filters.stopId} OR stop_id IS NULL)`);
    }
    if (filters.routeId !== null) {
      conditions.push(sql`(route_id = ${filters.routeId} OR route_id IS NULL)`);
    }
    if (filters.from !== null) {
      conditions.push(sql`(ends_at IS NULL OR ends_at >= ${filters.from})`);
    }
    if (filters.to !== null) {
      conditions.push(sql`(starts_at IS NULL OR starts_at <= ${filters.to})`);
    }
    const result = await executor.execute(sql`
      SELECT id, kind, impact::text AS impact, text, source_url, starts_at, ends_at,
             stop_id, route_id, acknowledged_at, institution_name
      FROM notices_public
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY starts_at DESC NULLS LAST, created_at DESC
      LIMIT ${filters.limit}
    `);
    return result.rows.map((row) => toContext(row as Record<string, unknown>));
  }

  async createIncident(
    tx: Transaction,
    input: {
      kind: string;
      impact: IncidentImpact;
      text: string;
      sourceUrl: string;
      stopId: string | null;
      routeId: string | null;
      cityId: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      publicVisible: boolean;
    },
  ): Promise<string> {
    const result = await tx.execute(sql`
      INSERT INTO notices (
        kind, impact, text, source_url, stop_id, route_id, city_id,
        starts_at, ends_at, public_visible
      ) VALUES (
        ${input.kind}, ${input.impact}, ${input.text}, ${input.sourceUrl},
        ${input.stopId}, ${input.routeId}, ${input.cityId},
        ${input.startsAt}, ${input.endsAt}, ${input.publicVisible}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Pengumuman gagal dibuat.');
    }
    return asString(row.id, 'id');
  }

  async acknowledgeIncident(
    tx: Transaction,
    noticeId: string,
    institutionId: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE notices
      SET acknowledged_at = now(), acknowledged_by = ${institutionId}
      WHERE id = ${noticeId} AND acknowledged_at IS NULL
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async insertSnapshot(
    executor: Database | Transaction,
    input: SnapshotInsert,
  ): Promise<SnapshotRow | null> {
    const result = await executor.execute(sql`
      INSERT INTO analysis_snapshots (
        subject_kind, subject_ref, method_version, parameters, dataset_digest,
        output_digest, input_rows, window_start, window_end, evidence_level,
        direction, warnings, provenance
      ) VALUES (
        ${input.subjectKind}, ${input.subjectRef}, ${input.methodVersion},
        ${JSON.stringify(input.parameters)}::jsonb, ${input.datasetDigest},
        ${input.outputDigest}, ${input.inputRows}, ${input.windowStart},
        ${input.windowEnd}, ${input.evidenceLevel}, ${input.direction},
        ${sql.raw(`ARRAY[${input.warnings.map((warning) => `'${warning.replace(/'/g, "''")}'`).join(',')}]::text[]`)},
        ${JSON.stringify(input.provenance)}::jsonb
      )
      ON CONFLICT (subject_kind, subject_ref, method_version, dataset_digest) DO NOTHING
      RETURNING ${SNAPSHOT_COLUMNS}
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toSnapshot(row);
  }

  async loadObservationPoints(
    executor: Database | Transaction,
    filters: ObservationFilters,
  ): Promise<ObservationPointRow[]> {
    const routeCondition =
      filters.routeId === null ? sql`` : sql`AND route_id = ${filters.routeId}`;
    const simulatedCondition = filters.includeSimulated
      ? sql``
      : sql`AND NOT ('simulated' = ANY(quality_flags))`;
    const result = await executor.execute(sql`
      SELECT
        to_char(started_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS day,
        EXTRACT(HOUR FROM (started_at AT TIME ZONE 'Asia/Jakarta'))::int AS hour,
        device_hash || ':' ||
          to_char(started_at AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD') AS device_day
      FROM wait_episodes
      WHERE stop_id = ${filters.stopId}
        AND started_at >= ${filters.start}
        AND started_at <= ${filters.end}
        AND NOT ('cluster_anomaly' = ANY(quality_flags))
        ${routeCondition}
        ${simulatedCondition}
      ORDER BY started_at
      LIMIT 20000
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        day: asString(record.day, 'day'),
        hour: asNumber(record.hour) ?? 0,
        deviceDay: asString(record.device_day, 'device_day'),
      };
    });
  }

  async findLatestSnapshot(
    executor: Database | Transaction,
    subjectKind: 'stop_estimate' | 'route_coverage',
    subjectRef: string,
  ): Promise<SnapshotRow | null> {
    const result = await executor.execute(sql`
      SELECT ${SNAPSHOT_COLUMNS}
      FROM analysis_snapshots
      WHERE subject_kind = ${subjectKind} AND subject_ref = ${subjectRef}
      ORDER BY computed_at DESC
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toSnapshot(row);
  }

  async findSnapshotById(
    executor: Database | Transaction,
    id: string,
  ): Promise<SnapshotRow | null> {
    const result = await executor.execute(sql`
      SELECT ${SNAPSHOT_COLUMNS}
      FROM analysis_snapshots
      WHERE id = ${id}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toSnapshot(row);
  }
}
