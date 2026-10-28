import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';

export interface ExportRow {
  id: string;
  institutionId: string;
  requestedBy: string;
  format: string;
  scope: Record<string, unknown>;
  status: string;
  objectKey: string | null;
  rowCount: number | null;
  byteSize: number | null;
  errorCode: string | null;
  createdAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

export interface ExportReportRow {
  publicId: string;
  category: string;
  status: string;
  stopCode: string;
  stopName: string;
  createdAt: Date;
  resolvedAt: Date | null;
  corroborationCount: number;
  evidenceScore: number;
  evidenceLevel: string;
  text: string;
}

export interface ExportFilters {
  category: string | null;
  status: string | null;
  from: Date | null;
  to: Date | null;
}

export const EXPORT_ROW_LIMIT = 5_000;

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
  const parsed = typeof value === 'number' ? value : Number(value);
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

function toExport(row: Record<string, unknown>): ExportRow {
  const scope = row.scope;
  return {
    id: asString(row.id, 'id'),
    institutionId: asString(row.institution_id, 'institution_id'),
    requestedBy: asString(row.requested_by, 'requested_by'),
    format: asString(row.format, 'format'),
    scope:
      scope !== null && typeof scope === 'object' && !Array.isArray(scope)
        ? (scope as Record<string, unknown>)
        : {},
    status: asString(row.status, 'status'),
    objectKey: asNullableString(row.object_key),
    rowCount: asNumber(row.row_count),
    byteSize: asNumber(row.byte_size),
    errorCode: asNullableString(row.error_code),
    createdAt: asDate(row.created_at),
    completedAt: asNullableDate(row.completed_at),
    expiresAt: asNullableDate(row.expires_at),
  };
}

@Injectable()
export class ExportRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(
    tx: Transaction,
    input: {
      institutionId: string;
      requestedBy: string;
      format: string;
      scope: Record<string, unknown>;
      expiresAt: Date;
    },
  ): Promise<ExportRow> {
    const result = await tx.execute(sql`
      INSERT INTO exports (institution_id, requested_by, format, scope, status, expires_at)
      VALUES (${input.institutionId}, ${input.requestedBy}, ${input.format},
              ${JSON.stringify(input.scope)}::jsonb, 'running', ${input.expiresAt})
      RETURNING id, institution_id, requested_by, format, scope, status,
                object_key, row_count, byte_size, error_code, created_at,
                completed_at, expires_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Export gagal dibuat.');
    }
    return toExport(row);
  }

  async markReady(
    tx: Transaction,
    exportId: string,
    input: { objectKey: string; rowCount: number; byteSize: number; expiresAt: Date },
  ): Promise<ExportRow> {
    const result = await tx.execute(sql`
      UPDATE exports
      SET status = 'ready', object_key = ${input.objectKey}, row_count = ${input.rowCount},
          byte_size = ${input.byteSize}, completed_at = now(), expires_at = ${input.expiresAt}
      WHERE id = ${exportId} AND status = 'running'
      RETURNING id, institution_id, requested_by, format, scope, status,
                object_key, row_count, byte_size, error_code, created_at,
                completed_at, expires_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Export gagal diselesaikan.');
    }
    return toExport(row);
  }

  async markFailed(tx: Transaction, exportId: string, code: string): Promise<void> {
    await tx.execute(sql`
      UPDATE exports
      SET status = 'failed', error_code = ${code}, completed_at = now()
      WHERE id = ${exportId} AND status = 'running'
    `);
  }

  async find(
    executor: Database | Transaction,
    exportId: string,
    institutionId: string,
  ): Promise<ExportRow | null> {
    const result = await executor.execute(sql`
      SELECT id, institution_id, requested_by, format, scope, status,
             object_key, row_count, byte_size, error_code, created_at,
             completed_at, expires_at
      FROM exports
      WHERE id = ${exportId} AND institution_id = ${institutionId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toExport(row);
  }

  async findById(
    executor: Database | Transaction,
    exportId: string,
  ): Promise<ExportRow | null> {
    const result = await executor.execute(sql`
      SELECT id, institution_id, requested_by, format, scope, status,
             object_key, row_count, byte_size, error_code, created_at,
             completed_at, expires_at
      FROM exports
      WHERE id = ${exportId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toExport(row);
  }

  async list(
    executor: Database | Transaction,
    institutionId: string,
    limit: number,
  ): Promise<ExportRow[]> {
    const result = await executor.execute(sql`
      SELECT id, institution_id, requested_by, format, scope, status,
             object_key, row_count, byte_size, error_code, created_at,
             completed_at, expires_at
      FROM exports
      WHERE institution_id = ${institutionId}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => toExport(row as Record<string, unknown>));
  }

  async collectRows(
    executor: Database | Transaction,
    institutionId: string,
    filters: ExportFilters,
    limit: number,
  ): Promise<ExportReportRow[]> {
    const conditions: SQL[] = [sql`r.institution_id = ${institutionId}`];
    if (filters.category !== null) {
      conditions.push(sql`r.category = ${filters.category}`);
    }
    if (filters.status !== null) {
      conditions.push(sql`r.status = ${filters.status}`);
    }
    if (filters.from !== null) {
      conditions.push(sql`r.created_at >= ${filters.from}`);
    }
    if (filters.to !== null) {
      conditions.push(sql`r.created_at <= ${filters.to}`);
    }
    const result = await executor.execute(sql`
      SELECT r.public_id, r.category::text AS category, r.status::text AS status,
             s.code AS stop_code, s.name AS stop_name, r.created_at, r.resolved_at,
             r.corroboration_count, r.evidence_score, r.evidence_level::text AS evidence_level,
             r.text
      FROM reports r
      JOIN stops s ON s.id = r.stop_id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        publicId: asString(record.public_id, 'public_id'),
        category: asString(record.category, 'category'),
        status: asString(record.status, 'status'),
        stopCode: asString(record.stop_code, 'stop_code'),
        stopName: asString(record.stop_name, 'stop_name'),
        createdAt: asDate(record.created_at),
        resolvedAt: asNullableDate(record.resolved_at),
        corroborationCount: asNumber(record.corroboration_count) ?? 0,
        evidenceScore: asNumber(record.evidence_score) ?? 0,
        evidenceLevel: asString(record.evidence_level, 'evidence_level'),
        text: asString(record.text, 'text'),
      };
    });
  }

  async countSince(
    executor: Database | Transaction,
    institutionId: string,
    since: Date,
  ): Promise<number> {
    const result = await executor.execute(sql`
      SELECT count(*)::int AS total
      FROM exports
      WHERE institution_id = ${institutionId} AND created_at >= ${since}
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? 0 : Number(row.total ?? 0);
  }
}
