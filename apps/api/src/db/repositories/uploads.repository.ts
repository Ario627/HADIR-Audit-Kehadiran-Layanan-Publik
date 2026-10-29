import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Database, Transaction } from '../client';
import { DATABASE } from '../db.module';

export type UploadStatus = 'pending' | 'stored' | 'rejected' | 'attached';
export type UploadPurpose = 'report_photo' | 'closure_evidence';

export interface UploadRow {
  id: string;
  deviceHash: string;
  tokenHash: Buffer;
  purpose: UploadPurpose;
  declaredMime: string;
  declaredSize: number;
  actualMime: string | null;
  actualSize: number | null;
  width: number | null;
  height: number | null;
  sha256: Buffer | null;
  objectKey: string | null;
  status: UploadStatus;
  hasExif: boolean;
  reportId: string | null;
  expiresAt: Date;
}

export interface CreateUploadInput {
  deviceHash: string;
  tokenHash: Buffer;
  purpose: UploadPurpose;
  declaredMime: string;
  declaredSize: number;
  expiresAt: Date;
}

export interface StoreUploadInput {
  id: string;
  actualMime: string;
  actualSize: number;
  width: number;
  height: number;
  sha256: Buffer;
  objectKey: string;
  hasExif: boolean;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Kolom ${field} bukan teks.`);
  }
  return value;
}

function asNumber(value: unknown, field: string): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    return Number(value);
  }
  throw new Error(`Kolom ${field} bukan angka.`);
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

function toUpload(row: Record<string, unknown>): UploadRow {
  return {
    id: asString(row.id, 'id'),
    deviceHash: asString(row.device_hash, 'device_hash'),
    tokenHash: Buffer.isBuffer(row.token_hash) ? row.token_hash : Buffer.alloc(0),
    purpose: asString(row.purpose, 'purpose') as UploadPurpose,
    declaredMime: asString(row.declared_mime, 'declared_mime'),
    declaredSize: asNumber(row.declared_size, 'declared_size'),
    actualMime: row.actual_mime === null ? null : asString(row.actual_mime, 'actual_mime'),
    actualSize:
      row.actual_size === null || row.actual_size === undefined
        ? null
        : asNumber(row.actual_size, 'actual_size'),
    width: row.width === null || row.width === undefined ? null : asNumber(row.width, 'width'),
    height: row.height === null || row.height === undefined ? null : asNumber(row.height, 'height'),
    sha256: Buffer.isBuffer(row.sha256) ? row.sha256 : null,
    objectKey: row.object_key === null ? null : asString(row.object_key, 'object_key'),
    status: asString(row.status, 'status') as UploadStatus,
    hasExif: row.has_exif === true,
    reportId: row.report_id === null ? null : asString(row.report_id, 'report_id'),
    expiresAt: asDate(row.expires_at, 'expires_at'),
  };
}

@Injectable()
export class UploadsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(input: CreateUploadInput): Promise<string> {
    const result = await this.db.execute(sql`
      INSERT INTO uploads (device_hash, token_hash, purpose, declared_mime, declared_size, expires_at)
      VALUES (
        ${input.deviceHash}, ${input.tokenHash}, ${input.purpose},
        ${input.declaredMime}, ${input.declaredSize}, ${input.expiresAt}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return asString(row?.id, 'id');
  }

  async findById(executor: Database | Transaction, id: string): Promise<UploadRow | null> {
    const result = await executor.execute(sql`
      SELECT id, device_hash, token_hash, purpose, declared_mime, declared_size, actual_mime,
             actual_size, width, height, sha256, object_key, status, has_exif, report_id, expires_at
      FROM uploads WHERE id = ${id} LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toUpload(row);
  }

  async markStored(input: StoreUploadInput): Promise<boolean> {
    const result = await this.db.execute(sql`
      UPDATE uploads
      SET actual_mime = ${input.actualMime},
          actual_size = ${input.actualSize},
          width = ${input.width},
          height = ${input.height},
          sha256 = ${input.sha256},
          object_key = ${input.objectKey},
          has_exif = ${input.hasExif},
          status = 'stored',
          stored_at = now()
      WHERE id = ${input.id} AND status = 'pending'
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async markRejected(id: string, code: string): Promise<void> {
    await this.db.execute(sql`
      UPDATE uploads SET status = 'rejected', rejection_code = ${code}
      WHERE id = ${id} AND status = 'pending'
    `);
  }

  async attachToReport(
    executor: Database | Transaction,
    id: string,
    reportId: string,
  ): Promise<boolean> {
    const result = await executor.execute(sql`
      UPDATE uploads SET status = 'attached', report_id = ${reportId}
      WHERE id = ${id} AND status = 'stored'
      RETURNING id
    `);
    return result.rows.length === 1;
  }

  async insertReportMedia(
    executor: Database | Transaction,
    values: {
      reportId: string;
      objectKey: string;
      mime: string;
      width: number;
      height: number;
      sha256: Buffer;
    },
  ): Promise<void> {
    await executor.execute(sql`
      INSERT INTO report_media (report_id, object_key, mime, width, height, sha256, status)
      VALUES (
        ${values.reportId}, ${values.objectKey}, ${values.mime},
        ${values.width}, ${values.height}, ${values.sha256}, 'pending'
      )
    `);
  }
}
