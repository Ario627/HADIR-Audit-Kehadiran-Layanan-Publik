import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type {
  PartnerExportDetail,
  PartnerExportInput,
  PartnerExportTicket,
} from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerSession } from '../../common/auth/partner-session';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';
import { OBJECT_STORAGE, objectKeyFor, type ObjectStorage } from '../../common/storage/object-storage';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import {
  EXPORT_ROW_LIMIT,
  ExportRepository,
  type ExportReportRow,
  type ExportRow,
} from '../../db/repositories/export.repository';

export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_HOURLY_LIMIT = 5;
const SIGNED_URL_TTL_MS = 10 * 60 * 1000;

const CSV_COLUMNS = [
  'public_id',
  'category',
  'status',
  'stop_code',
  'stop_name',
  'created_at',
  'resolved_at',
  'corroboration_count',
  'evidence_score',
  'evidence_level',
  'text',
] as const;

function csvCell(raw: string | null): string {
  if (raw === null) {
    return '';
  }
  const needsQuotes = /[",\n\r]/u.test(raw);
  const escaped = raw.replace(/"/gu, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function csvRow(values: readonly (string | null)[]): string {
  return values.map(csvCell).join(',');
}

export function toCsv(rows: readonly ExportReportRow[]): string {
  const lines: string[] = [csvRow([...CSV_COLUMNS])];
  for (const row of rows) {
    lines.push(
      csvRow([
        row.publicId,
        row.category,
        row.status,
        row.stopCode,
        row.stopName,
        row.createdAt.toISOString(),
        row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
        String(row.corroborationCount),
        row.evidenceScore.toFixed(2),
        row.evidenceLevel,
        row.text.replace(/\r?\n/gu, ' '),
      ]),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

export function toOpen311(rows: readonly ExportReportRow[]): string {
  const payload = rows.map((row) => ({
    service_request_id: row.publicId,
    service_code: row.category,
    status: row.status,
    address_string: `${row.stopCode} ${row.stopName}`.trim(),
    requested_datetime: row.createdAt.toISOString(),
    updated_datetime: (row.resolvedAt ?? row.createdAt).toISOString(),
    description: row.text.replace(/\r?\n/gu, ' '),
  }));
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export function signDownload(
  secret: string,
  exportId: string,
  institutionId: string,
  expiresAtMs: number,
): string {
  return createHmac('sha256', secret)
    .update(`${exportId}|${institutionId}|${expiresAtMs}`)
    .digest('base64url');
}

export function verifyDownloadSignature(input: {
  secret: string;
  exportId: string;
  institutionId: string;
  expiresAtMs: number;
  signature: string;
  nowMs: number;
}): boolean {
  if (!Number.isFinite(input.expiresAtMs) || input.expiresAtMs <= input.nowMs) {
    return false;
  }
  const expected = Buffer.from(
    signDownload(input.secret, input.exportId, input.institutionId, input.expiresAtMs),
    'utf8',
  );
  const provided = Buffer.from(input.signature, 'utf8');
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}

export function downloadPath(exportId: string, expiresAtMs: number, signature: string): string {
  const params = new URLSearchParams({
    exp: String(expiresAtMs),
    sig: signature,
  });
  return `/v1/partner/exports/${exportId}/download?${params.toString()}`;
}

export function toExportTicket(row: ExportRow): PartnerExportTicket {
  return {
    exportId: row.id,
    status: row.status as PartnerExportTicket['status'],
    format: row.format as PartnerExportTicket['format'],
    createdAt: row.createdAt.toISOString(),
  };
}

export function toExportDetail(row: ExportRow, now: Date = new Date()): PartnerExportDetail {
  const ready =
    row.status === 'ready' &&
    row.expiresAt !== null &&
    row.expiresAt.getTime() > now.getTime() &&
    row.objectKey !== null;
  const status = row.status === 'ready' && !ready ? 'expired' : row.status;
  const expiresAtMs = ready === false ? 0 : now.getTime() + SIGNED_URL_TTL_MS;
  return {
    exportId: row.id,
    status: status as PartnerExportDetail['status'],
    format: row.format as PartnerExportDetail['format'],
    rowCount: row.rowCount,
    byteSize: row.byteSize,
    downloadUrl: ready
      ? downloadPath(
          row.id,
          expiresAtMs,
          signDownload(env.SESSION_SECRET, row.id, row.institutionId, expiresAtMs),
        )
      : null,
    expiresAt: row.expiresAt === null ? null : row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class PartnerExportsService {
  constructor(
    private readonly repository: ExportRepository,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  async create(
    input: PartnerExportInput,
    session: PartnerSession,
    requestId: string,
    now: Date = new Date(),
  ): Promise<PartnerExportTicket> {
    const since = new Date(now.getTime() - 3_600_000);
    const created = await this.run(
      async (tx) => {
        const recent = await this.repository.countSince(tx, session.institutionId, since);
        if (recent >= EXPORT_HOURLY_LIMIT) {
          throw new AppError('RATE_LIMITED', {
            detail: `Maksimal ${EXPORT_HOURLY_LIMIT} export per jam.`,
          });
        }
        return this.repository.create(tx, {
          institutionId: session.institutionId,
          requestedBy: session.userId,
          format: input.format,
          scope: {
            from: input.from ?? null,
            to: input.to ?? null,
            category: input.category ?? null,
            status: input.status ?? null,
          },
          expiresAt: new Date(now.getTime() + EXPORT_TTL_MS),
        });
      },
      {
        institutionId: session.institutionId,
        userId: session.userId,
        requestId,
      },
    );

    await this.audit.record({
      action: 'export.requested',
      objectType: 'export',
      objectId: created.id,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      requestId,
      payload: { format: input.format },
    });

    try {
      const ready = await this.fill(created, input, session, requestId);
      return toExportTicket(ready);
    } catch (error) {
      await this.run(
        (tx) =>
          this.repository.markFailed(
            tx,
            created.id,
            error instanceof AppError ? error.code : 'EXPORT_FAILED',
          ),
        {
          institutionId: session.institutionId,
          userId: session.userId,
          requestId,
        },
      );
      await this.audit.record({
        action: 'export.failed',
        objectType: 'export',
        objectId: created.id,
        actor: {
          kind: 'partner',
          userId: session.userId,
          institutionId: session.institutionId,
          role: session.role,
        },
        requestId,
        payload: { message: error instanceof Error ? error.message.slice(0, 120) : 'unknown' },
      });
      throw error instanceof AppError
        ? error
        : new AppError('SERVICE_UNAVAILABLE', { detail: 'Export gagal dibuat.' });
    }
  }

  private async fill(
    created: ExportRow,
    input: PartnerExportInput,
    session: PartnerSession,
    requestId: string,
  ): Promise<ExportRow> {
    const rows = await this.run(
      (tx) =>
        this.repository.collectRows(
          tx,
          session.institutionId,
          {
            category: input.category ?? null,
            status: input.status ?? null,
            from: input.from === undefined ? null : new Date(input.from),
            to: input.to === undefined ? null : new Date(input.to),
          },
          EXPORT_ROW_LIMIT,
        ),
      { institutionId: session.institutionId, userId: session.userId, requestId },
    );

    const body = Buffer.from(
      input.format === 'csv' ? toCsv(rows) : toOpen311(rows),
      'utf8',
    );
    const extension = input.format === 'csv' ? 'csv' : 'json';
    const objectKey = objectKeyFor('exports', body, extension);
    try {
      await this.storage.put({ key: objectKey, bytes: body });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        throw error;
      }
    }

    const expiresAt = new Date(Date.now() + EXPORT_TTL_MS);
    const ready = await this.run(
      (tx) =>
        this.repository.markReady(tx, created.id, {
          objectKey,
          rowCount: rows.length,
          byteSize: body.length,
          expiresAt,
        }),
      { institutionId: session.institutionId, userId: session.userId, requestId },
    );

    await this.audit.record({
      action: 'export.ready',
      objectType: 'export',
      objectId: created.id,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      requestId,
      payload: { rowCount: rows.length, byteSize: body.length },
    });

    return ready;
  }

  async detail(
    exportId: string,
    session: PartnerSession,
    now: Date = new Date(),
  ): Promise<PartnerExportDetail> {
    const row = await this.run(
      (tx) => this.repository.find(tx, exportId, session.institutionId),
      {
        institutionId: session.institutionId,
        userId: session.userId,
        requestId: `partner-export-read-${session.userId.slice(0, 8)}`,
      },
    );
    if (row === null) {
      throw new AppError('NOT_FOUND', { detail: 'Export tidak ditemukan.' });
    }
    return toExportDetail(row, now);
  }

  async list(session: PartnerSession, limit: number): Promise<PartnerExportDetail[]> {
    const rows = await this.run(
      (tx) => this.repository.list(tx, session.institutionId, limit),
      {
        institutionId: session.institutionId,
        userId: session.userId,
        requestId: `partner-export-read-${session.userId.slice(0, 8)}`,
      },
    );
    return rows.map((row) => toExportDetail(row));
  }

  async readObject(
    exportId: string,
    session: PartnerSession,
  ): Promise<{ bytes: Buffer; format: string }> {
    const row = await this.run(
      (tx) => this.repository.find(tx, exportId, session.institutionId),
      {
        institutionId: session.institutionId,
        userId: session.userId,
        requestId: `partner-export-read-${session.userId.slice(0, 8)}`,
      },
    );
    return this.serveRow(row);
  }

  async readObjectWithSignature(input: {
    exportId: string;
    expiresAtMs: number;
    signature: string;
    now: Date;
  }): Promise<{ bytes: Buffer; format: string }> {
    const row = await this.run(
      (tx) => this.repository.findById(tx, input.exportId),
      {
        scope: 'partner',
        requestId: `export-download-${input.exportId.slice(0, 8)}`,
      },
    );
    if (row === null) {
      throw new AppError('NOT_FOUND', { detail: 'Export tidak ditemukan.' });
    }
    if (
      !verifyDownloadSignature({
        secret: env.SESSION_SECRET,
        exportId: row.id,
        institutionId: row.institutionId,
        expiresAtMs: input.expiresAtMs,
        signature: input.signature,
        nowMs: input.now.getTime(),
      })
    ) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Tautan unduh tidak valid.' });
    }
    return this.serveRow(row);
  }

  private async serveRow(row: ExportRow | null): Promise<{ bytes: Buffer; format: string }> {
    if (row === null || row.objectKey === null) {
      throw new AppError('NOT_FOUND', { detail: 'Export tidak ditemukan.' });
    }
    if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) {
      throw new AppError('NOT_FOUND', { detail: 'Export sudah kedaluwarsa.' });
    }
    const bytes = await this.storage.get(row.objectKey);
    if (bytes === null) {
      throw new AppError('NOT_FOUND', { detail: 'Berkas export tidak tersedia.' });
    }
    return { bytes, format: row.format };
  }
}
