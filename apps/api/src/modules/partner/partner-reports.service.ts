import { Inject, Injectable } from '@nestjs/common';
import type {
  PartnerActionInput,
  PartnerActionResult,
  PartnerInboxQuery,
  ReportDetail,
} from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerSession } from '../../common/auth/partner-session';
import { AppError } from '../../common/errors/app-error';
import { idempotencyHash } from '../../common/http/idempotency-key';
import type { IdempotencyContext } from '../../common/idempotency/idempotency.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import type { Transaction } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { ReportsRepository, type StoredEventKind } from '../../db/repositories/reports.repository';
import { nextCursorOf, parseCursor } from '../reports/reports.cursor';
import { toDetail, type ReportListResult } from '../reports/reports.mapper';
import {
  allowedPartnerActions,
  eventKindForAction,
  partnerTransition,
} from '../reports/reports.partner-machine';
import { sanitizeNote } from '../reports/reports.text';
import { assertPartnerCanAct, partnerIdempotencyScope } from './partner-scope';

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class PartnerReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private async recordEvent(
    tx: Transaction,
    reportId: string,
    kind: StoredEventKind,
    payload: Record<string, unknown>,
    session: PartnerSession,
  ): Promise<void> {
    await this.repository.appendEvent(tx, reportId, {
      kind,
      actorType: 'partner',
      actorId: session.userId,
      payload,
      sourceUrl: null,
    });
  }

  async listInbox(
    query: PartnerInboxQuery,
    session: PartnerSession,
  ): Promise<ReportListResult> {
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listForInstitution(tx, session.institutionId, {
          category: query.category ?? null,
          status: query.status ?? null,
          bbox: null,
          cursor: parseCursor(query.cursor),
          limit: query.limit,
        }),
      {
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-read-${session.userId.slice(0, 8)}`,
      },
    );
    return {
      items: items.map((row) => ({
        publicId: row.publicId,
        category: row.category,
        status: row.status,
        stopCode: row.stopCode ?? '',
        stopName: row.stopName ?? '',
        corroborationCount: row.corroborationCount,
        evidenceLevel: row.evidenceLevel,
        createdAt: row.createdAt.toISOString(),
      })),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async inboxDetail(publicId: string, session: PartnerSession): Promise<ReportDetail> {
    const loaded = await this.run(
      async (tx) => {
        const report = await this.repository.findInInstitution(
          tx,
          publicId,
          session.institutionId,
        );
        if (report === null) {
          return null;
        }
        const events = await this.repository.listEventsFor(tx, report.id);
        return { report, events };
      },
      {
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-read-${session.userId.slice(0, 8)}`,
      },
    );
    if (loaded === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    return toDetail(loaded.report, loaded.events);
  }

  async act(
    publicId: string,
    input: PartnerActionInput,
    key: string,
    session: PartnerSession,
    context: IdempotencyContext,
  ): Promise<PartnerActionResult> {
    assertPartnerCanAct(session);
    const note = sanitizeNote(input.note);
    const reason = sanitizeNote(input.reason);
    const institutionId = session.institutionId;

    const result = await this.idempotency.execute(
      {
        scope: partnerIdempotencyScope(session),
        key,
        requestHash: idempotencyHash({
          publicId,
          action: input.action,
          note,
          reason,
          institutionId,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
      },
      async (tx) => {
        const reportId = await this.repository.findReportIdInInstitution(
          tx,
          publicId,
          institutionId,
        );
        if (reportId === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        const locked = await this.repository.lockReportInInstitution(tx, reportId, institutionId);
        if (locked === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        const target = partnerTransition(locked.status, input.action);
        if (target === null) {
          throw new AppError('INVALID_TRANSITION', {
            detail: `Aksi ${input.action} tidak tersedia dari status ${locked.status}.`,
            errors: [
              {
                field: 'action',
                code: 'not_allowed',
                message: `Aksi yang tersedia: ${allowedPartnerActions(locked.status).join(', ') || 'tidak ada'}.`,
              },
            ],
          });
        }
        await this.repository.updateStatus(tx, reportId, target, null);
        await this.recordEvent(
          tx,
          reportId,
          eventKindForAction(input.action),
          {
            action: input.action,
            from: locked.status,
            to: target,
            hasNote: note !== null,
            hasReason: reason !== null,
          },
          session,
        );
        return {
          status: 200,
          body: {
            publicId,
            status: target,
            previousStatus: locked.status,
            simulated: false,
          },
        };
      },
      context,
    );

    const settled = result.body as PartnerActionResult;
    await this.audit.record({
      action: 'report.partner_action',
      objectType: 'report',
      objectId: publicId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId,
        role: session.role,
      },
      requestId: context.requestId,
      payload: {
        partnerAction: input.action,
        from: settled.previousStatus,
        to: settled.status,
      },
    });
    return settled;
  }
}
