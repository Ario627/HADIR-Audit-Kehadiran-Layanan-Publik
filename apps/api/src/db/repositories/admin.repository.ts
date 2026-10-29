import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';

export interface NoticeRow {
  id: string;
  kind: string;
  text: string;
  sourceUrl: string;
  cityId: string | null;
  stopId: string | null;
  routeId: string | null;
  institutionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}

export interface AuditRow {
  id: string;
  action: string;
  objectType: string;
  objectId: string | null;
  actorType: string;
  actorId: string | null;
  requestId: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
}

export interface RupRow {
  id: string;
  satker: string;
  name: string;
  locationText: string | null;
  fundingSource: string | null;
  pagu: number | null;
  method: string | null;
  fiscalYear: number;
  status: string | null;
  sourceUrl: string;
  fetchedAt: Date;
}

export interface FlagRow {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
}

export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface NoticeFilters {
  cityId: string | null;
  stopId: string | null;
  routeId: string | null;
  cursor: Cursor | null;
  limit: number;
}

export interface AuditFilters {
  action: string | null;
  objectType: string | null;
  objectId: string | null;
  since: Date | null;
  until: Date | null;
  cursor: Cursor | null;
  limit: number;
}

export interface RupFilters {
  satker: string | null;
  fiscalYear: number | null;
  keyword: string | null;
  cursor: Cursor | null;
  limit: number;
}

export interface InsertNoticeValues {
  kind: string;
  text: string;
  sourceUrl: string;
  cityId: string | null;
  stopId: string | null;
  routeId: string | null;
  institutionId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface UpsertRupValues {
  satker: string;
  name: string;
  locationText: string | null;
  fundingSource: string | null;
  pagu: string | null;
  method: string | null;
  fiscalYear: number;
  status: string | null;
  sourceUrl: string;
  fetchedAt: Date;
  matchKeywords: string[];
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asDate(value: unknown, field: string): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error(`Kolom ${field} bukan waktu.`);
}

function asNullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : asDate(value, 'timestamp');
}

function asNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNotice(row: Record<string, unknown>): NoticeRow {
  return {
    id: asString(row.id, 'id'),
    kind: asString(row.kind, 'kind'),
    text: asString(row.text, 'text'),
    sourceUrl: asString(row.source_url, 'source_url'),
    cityId: asNullableString(row.city_id),
    stopId: asNullableString(row.stop_id),
    routeId: asNullableString(row.route_id),
    institutionId: asNullableString(row.institution_id),
    startsAt: asNullableDate(row.starts_at),
    endsAt: asNullableDate(row.ends_at),
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function toAudit(row: Record<string, unknown>): AuditRow {
  const payload = row.payload;
  return {
    id: asString(row.id, 'id'),
    action: asString(row.action, 'action'),
    objectType: asString(row.object_type, 'object_type'),
    objectId: asNullableString(row.object_id),
    actorType: asString(row.actor_type, 'actor_type'),
    actorId: asNullableString(row.actor_id),
    requestId: asNullableString(row.request_id),
    payload:
      payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {},
    createdAt: asDate(row.created_at, 'created_at'),
  };
}

function toRup(row: Record<string, unknown>): RupRow {
  return {
    id: asString(row.id, 'id'),
    satker: asString(row.satker, 'satker'),
    name: asString(row.name, 'name'),
    locationText: asNullableString(row.location_text),
    fundingSource: asNullableString(row.funding_source),
    pagu: asNumberOrNull(row.pagu),
    method: asNullableString(row.method),
    fiscalYear: Number(row.fiscal_year ?? 0),
    status: asNullableString(row.status),
    sourceUrl: asString(row.source_url, 'source_url'),
    fetchedAt: asDate(row.fetched_at, 'fetched_at'),
  };
}

function toFlag(row: Record<string, unknown>): FlagRow {
  return {
    key: asString(row.key, 'key'),
    value: row.value,
    description: asNullableString(row.description),
    updatedAt: asDate(row.updated_at, 'updated_at'),
  };
}

function keyset(cursor: Cursor | null, createdAt: SQL | string, id: SQL | string): SQL | null {
  if (cursor === null) {
    return null;
  }
  return sql`(${createdAt}, ${id}) < (${cursor.createdAt}, ${cursor.id})`;
}

@Injectable()
export class AdminRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async insertNotice(tx: Transaction, values: InsertNoticeValues): Promise<NoticeRow> {
    const result = await tx.execute(sql`
      INSERT INTO notices (
        kind, text, source_url, city_id, stop_id, route_id, institution_id, starts_at, ends_at
      ) VALUES (
        ${values.kind}, ${values.text}, ${values.sourceUrl}, ${values.cityId},
        ${values.stopId}, ${values.routeId}, ${values.institutionId},
        ${values.startsAt}, ${values.endsAt}
      )
      RETURNING id, kind, text, source_url, city_id, stop_id, route_id,
                institution_id, starts_at, ends_at, created_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Notice gagal dibuat.');
    }
    return toNotice(row);
  }

  async listNotices(
    executor: Database | Transaction,
    filters: NoticeFilters,
  ): Promise<{ items: NoticeRow[]; hasMore: boolean }> {
    const conditions: SQL[] = [sql`true`];
    if (filters.cityId !== null) {
      conditions.push(sql`city_id = ${filters.cityId}`);
    }
    if (filters.stopId !== null) {
      conditions.push(sql`stop_id = ${filters.stopId}`);
    }
    if (filters.routeId !== null) {
      conditions.push(sql`route_id = ${filters.routeId}`);
    }
    const cursor = keyset(filters.cursor, sql`created_at`, sql`id`);
    if (cursor !== null) {
      conditions.push(cursor);
    }
    const result = await executor.execute(sql`
      SELECT id, kind, text, source_url, city_id, stop_id, route_id,
             institution_id, starts_at, ends_at, created_at
      FROM notices
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${filters.limit + 1}
    `);
    const rows = result.rows.map((row) => toNotice(row as Record<string, unknown>));
    const hasMore = rows.length > filters.limit;
    return { items: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  }

  async listAudit(
    executor: Database | Transaction,
    filters: AuditFilters,
  ): Promise<{ items: AuditRow[]; hasMore: boolean }> {
    const conditions: SQL[] = [sql`true`];
    if (filters.action !== null) {
      conditions.push(sql`action = ${filters.action}`);
    }
    if (filters.objectType !== null) {
      conditions.push(sql`object_type = ${filters.objectType}`);
    }
    if (filters.objectId !== null) {
      conditions.push(sql`object_id = ${filters.objectId}`);
    }
    if (filters.since !== null) {
      conditions.push(sql`created_at >= ${filters.since}`);
    }
    if (filters.until !== null) {
      conditions.push(sql`created_at <= ${filters.until}`);
    }
    const cursor = keyset(filters.cursor, sql`created_at`, sql`id`);
    if (cursor !== null) {
      conditions.push(cursor);
    }
    const result = await executor.execute(sql`
      SELECT id, action, object_type, object_id, actor_type, actor_id,
             request_id, payload, created_at
      FROM audit_log
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${filters.limit + 1}
    `);
    const rows = result.rows.map((row) => toAudit(row as Record<string, unknown>));
    const hasMore = rows.length > filters.limit;
    return { items: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  }

  async findModerationTarget(
    tx: Transaction,
    publicId: string,
  ): Promise<{ id: string; moderation: string } | null> {
    const result = await tx.execute(sql`
      SELECT id, moderation::text AS moderation
      FROM reports
      WHERE public_id = ${publicId}
      FOR UPDATE
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: asString(row.id, 'id'),
      moderation: asString(row.moderation, 'moderation'),
    };
  }

  async setModeration(tx: Transaction, reportId: string, moderation: string): Promise<void> {
    await tx.execute(sql`
      UPDATE reports SET moderation = ${moderation}, updated_at = now()
      WHERE id = ${reportId}
    `);
  }

  async setMediaStatus(tx: Transaction, reportId: string, status: string): Promise<number> {
    const result = await tx.execute(sql`
      UPDATE report_media SET status = ${status}
      WHERE report_id = ${reportId} AND status <> ${status}
      RETURNING id
    `);
    return result.rows.length;
  }

  async upsertFlag(
    tx: Transaction,
    input: { key: string; value: unknown; description: string | null; adminId: string },
  ): Promise<FlagRow> {
    const result = await tx.execute(sql`
      INSERT INTO feature_flags (key, value, description, updated_by, updated_at)
      VALUES (${input.key}, ${JSON.stringify(input.value)}::jsonb, ${input.description}, ${input.adminId}, now())
      ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            description = COALESCE(EXCLUDED.description, feature_flags.description),
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
      RETURNING key, value, description, updated_at
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Feature flag gagal disimpan.');
    }
    return toFlag(row);
  }

  async listFlags(executor: Database | Transaction): Promise<FlagRow[]> {
    const result = await executor.execute(sql`
      SELECT key, value, description, updated_at
      FROM feature_flags
      ORDER BY key ASC
    `);
    return result.rows.map((row) => toFlag(row as Record<string, unknown>));
  }

  async findFlag(
    executor: Database | Transaction,
    key: string,
  ): Promise<FlagRow | null> {
    const result = await executor.execute(sql`
      SELECT key, value, description, updated_at
      FROM feature_flags
      WHERE key = ${key}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toFlag(row);
  }

  async upsertRup(
    tx: Transaction,
    values: UpsertRupValues,
  ): Promise<{ inserted: boolean }> {
    const result = await tx.execute(sql`
      INSERT INTO rup_packages (
        satker, name, location_text, funding_source, pagu, method,
        fiscal_year, status, source_url, fetched_at, match_keywords
      ) VALUES (
        ${values.satker}, ${values.name}, ${values.locationText}, ${values.fundingSource},
        ${values.pagu}, ${values.method}, ${values.fiscalYear}, ${values.status},
        ${values.sourceUrl}, ${values.fetchedAt},
        ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values.matchKeywords)}::jsonb))
      )
      ON CONFLICT (satker, name, fiscal_year, source_url) DO UPDATE
        SET location_text = EXCLUDED.location_text,
            funding_source = EXCLUDED.funding_source,
            pagu = EXCLUDED.pagu,
            method = EXCLUDED.method,
            status = EXCLUDED.status,
            fetched_at = EXCLUDED.fetched_at,
            match_keywords = EXCLUDED.match_keywords      RETURNING (xmax = 0) AS inserted
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return { inserted: row?.inserted === true };
  }

  async listRup(
    executor: Database | Transaction,
    filters: RupFilters,
  ): Promise<{ items: RupRow[]; hasMore: boolean }> {
    const conditions: SQL[] = [sql`true`];
    if (filters.satker !== null) {
      conditions.push(sql`satker = ${filters.satker}`);
    }
    if (filters.fiscalYear !== null) {
      conditions.push(sql`fiscal_year = ${filters.fiscalYear}`);
    }
    if (filters.keyword !== null) {
      conditions.push(sql`name ILIKE ${`%${filters.keyword}%`}`);
    }
    const cursor = keyset(filters.cursor, sql`created_at`, sql`id`);
    if (cursor !== null) {
      conditions.push(cursor);
    }
    const result = await executor.execute(sql`
      SELECT id, satker, name, location_text, funding_source, pagu, method,
             fiscal_year, status, source_url, fetched_at
      FROM rup_packages
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY created_at DESC, id DESC
      LIMIT ${filters.limit + 1}
    `);
    const rows = result.rows.map((row) => toRup(row as Record<string, unknown>));
    const hasMore = rows.length > filters.limit;
    return { items: hasMore ? rows.slice(0, filters.limit) : rows, hasMore };
  }
}
