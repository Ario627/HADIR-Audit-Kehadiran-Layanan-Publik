import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminAuditEntry,
  AdminAuditQuery,
  AdminChainVerifyResult,
  AdminFlagInput,
  AdminModerationInput,
  AdminModerationResult,
  AdminNoticeInput,
  AdminNoticeQuery,
  AdminRupImportInput,
  AdminRupImportResult,
  FeatureFlag,
  Notice,
  TransparencyAnchor,
} from '@hadir/contracts';
import { AdminChainVerifyInput } from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import type { PlatformAdminSession } from '../../common/auth/platform-session';
import { AppError } from '../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import type { Transaction } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { AdminRepository, type AuditRow, type NoticeRow, type RupRow } from '../../db/repositories/admin.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';
import { TransparencyService } from '../transparency/transparency.service';
import { cell, columnIndex, parseAmount, parseCsv, splitKeywords } from './admin.csv';

const RUP_MAX_ROWS = 5000;

export function toNotice(row: NoticeRow): Notice {
  return {
    id: row.id,
    kind: row.kind as Notice['kind'],
    text: row.text,
    sourceUrl: row.sourceUrl,
    cityId: row.cityId,
    stopId: row.stopId,
    routeId: row.routeId,
    institutionId: row.institutionId,
    startsAt: row.startsAt === null ? null : row.startsAt.toISOString(),
    endsAt: row.endsAt === null ? null : row.endsAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toAuditEntry(row: AuditRow): AdminAuditEntry {
  return {
    id: row.id,
    action: row.action,
    objectType: row.objectType,
    objectId: row.objectId,
    actorType: row.actorType as AdminAuditEntry['actorType'],
    actorId: row.actorId,
    requestId: row.requestId,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toFeatureFlag(row: {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
}): FeatureFlag {
  return {
    key: row.key,
    value: row.value,
    description: row.description,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toRupRow(row: RupRow): Record<string, unknown> {
  return {
    id: row.id,
    satker: row.satker,
    name: row.name,
    locationText: row.locationText,
    fundingSource: row.fundingSource,
    pagu: row.pagu,
    method: row.method,
    fiscalYear: row.fiscalYear,
    status: row.status,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

export function parseOptionalDate(raw: string | undefined): Date | null {
  if (raw === undefined) {
    return null;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

@Injectable()
export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly reports: ReportsRepository,
    private readonly audit: AuditService,
    private readonly transparency: TransparencyService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private adminContext(session: PlatformAdminSession, requestId: string) {
    return { scope: 'admin' as const, requestId, userId: session.adminId };
  }

  async createNotice(
    input: AdminNoticeInput,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<Notice> {
    const created = await this.run(
      (tx) =>
        this.repository.insertNotice(tx, {
          kind: input.kind,
          text: input.text,
          sourceUrl: input.sourceUrl,
          cityId: input.cityId ?? null,
          stopId: input.stopId ?? null,
          routeId: input.routeId ?? null,
          institutionId: input.institutionId ?? null,
          startsAt: input.startsAt === undefined || input.startsAt === null
            ? null
            : new Date(input.startsAt),
          endsAt: input.endsAt === undefined || input.endsAt === null
            ? null
            : new Date(input.endsAt),
        }),
      this.adminContext(session, requestId),
    );

    await this.audit.record({
      action: 'admin.notice_created',
      objectType: 'notice',
      objectId: created.id,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: { kind: input.kind },
    });

    return toNotice(created);
  }

  async listNotices(query: AdminNoticeQuery): Promise<{
    items: Notice[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = query.limit;
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listNotices(tx, {
          cityId: query.cityId ?? null,
          stopId: query.stopId ?? null,
          routeId: query.routeId ?? null,
          cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
          limit,
        }),
      { scope: 'admin', requestId: `admin-notices-read` },
    );
    const last = items[items.length - 1];
    return {
      items: items.map(toNotice),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async listAudit(query: AdminAuditQuery): Promise<{
    items: AdminAuditEntry[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const limit = query.limit;
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listAudit(tx, {
          action: query.action ?? null,
          objectType: query.objectType ?? null,
          objectId: query.objectId ?? null,
          since: parseOptionalDate(query.since),
          until: parseOptionalDate(query.until),
          cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
          limit,
        }),
      { scope: 'admin', requestId: 'admin-audit-read' },
    );
    const last = items[items.length - 1];
    return {
      items: items.map(toAuditEntry),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async moderate(
    publicId: string,
    input: AdminModerationInput,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<AdminModerationResult> {
    const outcome = await this.run(
      async (tx) => {
        const target = await this.repository.findModerationTarget(tx, publicId);
        if (target === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        await this.repository.setModeration(tx, target.id, input.moderation);
        const mediaUpdated = await this.repository.setMediaStatus(
          tx,
          target.id,
          input.moderation === 'approved' ? 'approved' : 'rejected',
        );
        await this.appendModerationEvent(tx, target.id, input, session);
        return {
          previousModeration: target.moderation,
          mediaUpdated,
        };
      },
      this.adminContext(session, requestId),
    );

    await this.audit.record({
      action: 'admin.moderation',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: {
        from: outcome.previousModeration,
        to: input.moderation,
        mediaUpdated: outcome.mediaUpdated,
      },
    });

    return {
      publicId,
      moderation: input.moderation,
      previousModeration: outcome.previousModeration as AdminModerationResult['previousModeration'],
      mediaUpdated: outcome.mediaUpdated,
    };
  }

  private async appendModerationEvent(
    tx: Transaction,
    reportId: string,
    input: AdminModerationInput,
    session: PlatformAdminSession,
  ): Promise<void> {
    await this.reports.appendEvent(tx, reportId, {
      kind: 'moderated',
      actorType: session.role === 'superadmin' ? 'superadmin' : 'moderator',
      actorId: session.adminId,
      payload: {
        moderation: input.moderation,
        hasReason: input.reason !== undefined && input.reason.length > 0,
      },
      sourceUrl: null,
    });
  }

  async setFlag(
    key: string,
    input: AdminFlagInput,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<FeatureFlag> {
    const saved = await this.run(
      (tx) =>
        this.repository.upsertFlag(tx, {
          key,
          value: input.value ?? null,
          description: input.description ?? null,
          adminId: session.adminId,
        }),
      this.adminContext(session, requestId),
    );

    await this.audit.record({
      action: 'admin.flag_set',
      objectType: 'flag',
      objectId: key,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: { key },
    });

    return toFeatureFlag(saved);
  }

  async listFlags(): Promise<{ items: FeatureFlag[] }> {
    const rows = await this.run((tx) => this.repository.listFlags(tx), {
      scope: 'admin',
      requestId: 'admin-flags-read',
    });
    return { items: rows.map(toFeatureFlag) };
  }

  async verifyChain(
    input: AdminChainVerifyInput,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<AdminChainVerifyResult> {
    return this.transparency.verify(input, session, requestId);
  }

  async sealAnchor(
    date: string,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<TransparencyAnchor> {
    return this.transparency.seal(date, session, requestId);
  }

  async importRup(
    input: AdminRupImportInput,
    session: PlatformAdminSession,
    requestId: string,
  ): Promise<AdminRupImportResult> {
    let table;
    try {
      table = parseCsv(input.csv);
    } catch (error) {
      throw new AppError('VALIDATION_FAILED', {
        detail: error instanceof Error ? error.message : 'CSV tidak dapat dibaca.',
        errors: [{ field: 'csv', code: 'malformed', message: 'CSV tidak valid.' }],
      });
    }

    const satkerIndex = columnIndex(table.header, ['satker', 'kode_satker', 'unit']);
    const nameIndex = columnIndex(table.header, ['nama_paket', 'name', 'paket']);
    if (satkerIndex < 0 || nameIndex < 0) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'CSV wajib memiliki kolom satker dan nama_paket.',
        errors: [
          { field: 'csv', code: 'missing_header', message: 'Kolom satker/nama_paket tidak ditemukan.' },
        ],
      });
    }
    if (table.rows.length > RUP_MAX_ROWS) {
      throw new AppError('VALIDATION_FAILED', {
        detail: `Maksimal ${RUP_MAX_ROWS} baris per impor.`,
      });
    }

    const locationIndex = columnIndex(table.header, ['lokasi', 'location']);
    const fundingIndex = columnIndex(table.header, ['sumber_dana', 'funding_source']);
    const paguIndex = columnIndex(table.header, ['pagu', 'nilai']);
    const methodIndex = columnIndex(table.header, ['metode', 'method']);
    const statusIndex = columnIndex(table.header, ['status']);
    const keywordIndex = columnIndex(table.header, ['kata_kunci', 'keywords', 'match_keywords']);
    const yearIndex = columnIndex(table.header, ['tahun', 'fiscal_year']);

    const issues: AdminRupImportResult['issues'] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const now = new Date();

    if (input.dryRun) {
      for (let index = 0; index < table.rows.length; index += 1) {
        const row = table.rows[index]!;
        const satker = cell(row, satkerIndex);
        const name = cell(row, nameIndex);
        if (satker === null || name === null) {
          skipped += 1;
          if (issues.length < 100) {
            issues.push({ row: index + 2, message: 'satker atau nama_paket kosong.' });
          }
          continue;
        }
        inserted += 1;
      }
      return { inserted, updated, skipped, issues, dryRun: true };
    }

    for (let index = 0; index < table.rows.length; index += 1) {
      const row = table.rows[index]!;
      const satker = cell(row, satkerIndex);
      const name = cell(row, nameIndex);
      if (satker === null || name === null) {
        skipped += 1;
        if (issues.length < 100) {
          issues.push({ row: index + 2, message: 'satker atau nama_paket kosong.' });
        }
        continue;
      }
      const fiscalYearRaw = cell(row, yearIndex);
      const fiscalYear =
        fiscalYearRaw === null ? input.fiscalYear : Number(fiscalYearRaw);
      if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
        skipped += 1;
        if (issues.length < 100) {
          issues.push({ row: index + 2, message: 'tahun fiskal tidak valid.' });
        }
        continue;
      }
      const outcome = await this.run(
        (tx) =>
          this.repository.upsertRup(tx, {
            satker: satker.slice(0, 160),
            name: name.slice(0, 300),
            locationText: cell(row, locationIndex)?.slice(0, 300) ?? null,
            fundingSource: cell(row, fundingIndex)?.slice(0, 120) ?? null,
            pagu: parseAmount(cell(row, paguIndex)),
            method: cell(row, methodIndex)?.slice(0, 120) ?? null,
            fiscalYear,
            status: cell(row, statusIndex)?.slice(0, 80) ?? null,
            sourceUrl: input.sourceUrl,
            fetchedAt: now,
            matchKeywords: splitKeywords(cell(row, keywordIndex)),
          }),
        this.adminContext(session, requestId),
      );
      if (outcome.inserted) {
        inserted += 1;
      } else {
        updated += 1;
      }
    }

    await this.audit.record({
      action: 'admin.rup_import',
      objectType: 'rup',
      objectId: null,
      actor: { kind: session.role, userId: session.adminId },
      requestId,
      payload: { inserted, updated, skipped, fiscalYear: input.fiscalYear },
    });

    return { inserted, updated, skipped, issues, dryRun: false };
  }

  async listRup(query: {
    satker?: string | undefined;
    fiscalYear?: number | undefined;
    keyword?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null; hasMore: boolean }> {
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listRup(tx, {
          satker: query.satker ?? null,
          fiscalYear: query.fiscalYear ?? null,
          keyword: query.keyword ?? null,
          cursor: query.cursor === undefined ? null : decodeCursor(query.cursor),
          limit: query.limit,
        }),
      { scope: 'admin', requestId: 'admin-rup-read' },
    );
    const last = items[items.length - 1];
    return {
      items: items.map(toRupRow),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.fetchedAt, id: last.id })
          : null,
      hasMore,
    };
  }
}
