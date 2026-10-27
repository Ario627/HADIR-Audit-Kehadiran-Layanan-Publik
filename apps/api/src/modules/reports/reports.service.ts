import { Injectable } from '@nestjs/common';
import type {
  CorroborateInput,
  CreateReportInput,
  ListReportsQuery,
  MyReportsQuery,
  PartnerActionInput,
  PartnerInboxQuery,
  PartnerActionResult,
  ReportCategory,
  ReportDetail,
  ReportListItem,
  ReportStatus,
  VerifyClosureInput,
} from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerSession } from '../../common/auth/partner-session';
import { assertPartnerCanAct } from '../partner/partner-scope';
import { AppError } from '../../common/errors/app-error';
import { parseBbox } from '../../common/geo/bbox';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import { idempotencyHash } from '../../common/http/idempotency-key';
import type { DeviceIdentity } from '../../common/http/request-context';
import {
  IdempotencyService,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { nextPublicId } from '../../common/id/public-id';
import type { Transaction } from '../../db/client';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import {
  ReportsRepository,
  evidenceScore,
  type EventRecord,
  type ReportRow,
  type StoredEventKind,
  type StoredReportStatus,
} from '../../db/repositories/reports.repository';

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_TEXT_LENGTH = 20;
const MAX_NOTE_LENGTH = 280;
const SERVICE_CATEGORIES: ReadonlySet<ReportCategory> = new Set<ReportCategory>([
  'service_wait',
  'service_no_show',
  'service_full',
]);
const PUBLIC_LISTABLE: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
]);

export interface ReportListResult {
  items: ReportListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateReportResult {
  report: ReportDetail;
  warnings: string[];
}

interface CursorValue {
  createdAt: Date;
  id: string;
}

function isPrintable(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) {
    return true;
  }
  return code >= 32 && code !== 127;
}

export function sanitizeText(raw: string): string {
  let printable = '';
  for (const character of raw) {
    if (isPrintable(character.codePointAt(0) ?? 0)) {
      printable += character;
    }
  }
  const lines = printable
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0);
  return lines.join('\n');
}

export function assertUsableText(raw: string): string {
  const text = sanitizeText(raw);
  if (text.length < MIN_TEXT_LENGTH) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Teks laporan terlalu pendek setelah dibersihkan.',
      errors: [
        {
          field: 'text',
          code: 'too_short',
          message: `Tulis minimal ${MIN_TEXT_LENGTH} karakter yang dapat dibaca.`,
        },
      ],
    });
  }
  return text;
}

export function sanitizeNote(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const note = sanitizeText(raw);
  return note.length === 0 ? null : note.slice(0, MAX_NOTE_LENGTH);
}

export function toListItem(row: ReportRow): ReportListItem {
  return {
    publicId: row.publicId,
    category: row.category,
    status: row.status,
    stopCode: row.stopCode ?? '',
    stopName: row.stopName ?? '',
    corroborationCount: row.corroborationCount,
    evidenceLevel: row.evidenceLevel,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toDetail(row: ReportRow, events: readonly EventRecord[]): ReportDetail {
  return {
    ...toListItem(row),
    moderation: row.moderation,
    text: row.text,
    authorityName: row.authorityName,
    evidenceScore: row.evidenceScore,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    events: events.map((event) => ({
      kind: event.kind,
      actorType: event.actorType as ReportDetail['events'][number]['actorType'],
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export function statusAfterClosure(
  answer: 'yes' | 'no' | 'partial',
  now: Date,
): { status: StoredReportStatus; resolvedAt: Date | null } {
  return answer === 'yes'
    ? { status: 'verified_resolved', resolvedAt: now }
    : { status: 'disputed', resolvedAt: null };
}

export type PartnerActionKind =
  | 'acknowledge'
  | 'request_info'
  | 'schedule'
  | 'respond'
  | 'claim_resolved'
  | 'reject_with_reason';

const PARTNER_TRANSITIONS: Readonly<
  Record<StoredReportStatus, readonly PartnerActionKind[]>
> = {
  draft: ['acknowledge'],
  submitted: ['acknowledge', 'reject_with_reason'],
  triaged: ['acknowledge', 'reject_with_reason'],
  acknowledged: [
    'request_info',
    'schedule',
    'respond',
    'claim_resolved',
    'reject_with_reason',
  ],
  in_progress: ['respond', 'claim_resolved', 'reject_with_reason'],
  claimed_resolved: [],
  verified_resolved: [],
  disputed: ['respond', 'claim_resolved'],
  rejected: [],
  closed: [],
};

const PARTNER_TARGET: Readonly<Record<PartnerActionKind, StoredReportStatus>> = {
  acknowledge: 'acknowledged',
  request_info: 'in_progress',
  schedule: 'in_progress',
  respond: 'in_progress',
  claim_resolved: 'claimed_resolved',
  reject_with_reason: 'rejected',
};

export function allowedPartnerActions(
  status: StoredReportStatus,
): readonly PartnerActionKind[] {
  return PARTNER_TRANSITIONS[status] ?? [];
}

export function partnerTransition(
  status: StoredReportStatus,
  action: PartnerActionKind,
): StoredReportStatus | null {
  return allowedPartnerActions(status).includes(action)
    ? PARTNER_TARGET[action]
    : null;
}

export function eventKindForAction(action: PartnerActionKind): StoredEventKind {
  switch (action) {
    case 'acknowledge':
      return 'acknowledged';
    case 'request_info':
      return 'info_requested';
    case 'schedule':
      return 'scheduled';
    case 'respond':
      return 'responded';
    case 'claim_resolved':
      return 'claimed_resolved';
    case 'reject_with_reason':
      return 'rejected';
  }
}

export function assertDevice(device: DeviceIdentity): void {
  if (device.isNew) {
    throw new AppError('UNAUTHENTICATED', {
      detail: 'Panggil POST /v1/devices sebelum mengirim laporan.',
    });
  }
}

function parseCursor(raw: string | undefined): CursorValue | null {
  if (raw === undefined) {
    return null;
  }
  const decoded = decodeCursor(raw);
  return { createdAt: decoded.createdAt, id: decoded.id };
}

function nextCursorOf(items: readonly ReportRow[], hasMore: boolean): string | null {
  const last = items[items.length - 1];
  if (!hasMore || last === undefined) {
    return null;
  }
  return encodeCursor({ createdAt: last.createdAt, id: last.id });
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly devices: DevicesRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
  ) {}

  private async assertDeviceRecord(tx: Transaction, deviceHash: string): Promise<void> {
    const record = await this.devices.findByHash(tx, deviceHash);
    if (record === null) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Perangkat belum terdaftar.' });
    }
    if (record.revokedAt !== null) {
      throw new AppError('FORBIDDEN', { detail: 'Perangkat ini diblokir.' });
    }
  }

  private async recordEvent(
    tx: Transaction,
    reportId: string,
    kind: StoredEventKind,
    payload: Record<string, unknown>,
    actor: { type: 'citizen' | 'partner' | 'system'; deviceHash?: string; id?: string } = {
      type: 'citizen',
    },
  ): Promise<void> {
    const devicePrefix =
      actor.deviceHash === undefined ? {} : { devicePrefix: actor.deviceHash.slice(0, 8) };
    await this.repository.appendEvent(tx, reportId, {
      kind,
      actorType: actor.type,
      actorId: actor.id ?? null,
      payload: { ...payload, ...devicePrefix },
      sourceUrl: null,
    });
  }

  async create(
    input: CreateReportInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<CreateReportResult> {
    assertDevice(device);
    const text = assertUsableText(input.text);
    const warnings: string[] = [];
    if (input.contactEmail !== undefined && input.contactEmail !== null) {
      warnings.push('contact_email_ignored');
    }
    if (input.photoUploadId !== undefined && input.photoUploadId !== null) {
      warnings.push('photo_upload_ignored');
    }

    const result = await this.idempotency.execute(
      {
        scope: `report.create.${device.hash}`,
        key,
        requestHash: idempotencyHash({
          category: input.category,
          stopCode: input.stopCode,
          text,
          triageSessionId: input.triageSessionId ?? null,
          clientEventId: input.clientEventId,
        }),
        ttlMs: IDEMPOTENCY_TTL_MS,
      },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        const stop = await this.repository.findStopByCode(tx, input.stopCode);
        if (stop === null) {
          throw new AppError('NOT_FOUND', { detail: 'Halte tidak ditemukan.' });
        }
        if (stop.status !== 'active') {
          throw new AppError('STOP_INACTIVE', { detail: 'Halte sedang tidak aktif.' });
        }

        const authorityId = await this.repository.findAuthorityForStop(tx, stop.id);
        const verdict =
          input.triageSessionId === undefined || input.triageSessionId === null
            ? null
            : await this.repository.findSessionVerdict(tx, input.triageSessionId);
        const publicId = await nextPublicId(tx, new Date());
        const report = await this.repository.insertReport(tx, {
          publicId,
          category: input.category,
          stopId: stop.id,
          routeId: null,
          deviceHash: device.hash,
          deviceDayHash: device.dayHash,
          clientEventId: input.clientEventId,
          text,
          authorityId,
          evidenceScore: evidenceScore({
            hasStop: true,
            hasPlanMatch: verdict === 'already_planned',
            corroborations: 0,
            measurableCategory: SERVICE_CATEGORIES.has(input.category),
          }),
          evidenceLevel: 'none',
        });
        await this.recordEvent(
          tx,
          report.id,
          'submitted',
          {
            category: input.category,
            stopCode: stop.code,
            textLength: text.length,
            hasTriageSession:
              input.triageSessionId !== undefined && input.triageSessionId !== null,
          },
          { type: 'citizen', deviceHash: device.hash },
        );
        const events = await this.repository.listEvents(report.id);
        return { status: 201, body: { report: toDetail(report, events), warnings } };
      },
      context,
    );

    const created = result.body as CreateReportResult;
    await this.audit.record({
      action: 'report.create',
      objectType: 'report',
      objectId: created.report.publicId,
      actor: { kind: 'citizen', deviceHash: device.hash },
      requestId: context.requestId,
      payload: { category: input.category },
    });
    return created;
  }

  async listPublic(query: ListReportsQuery): Promise<ReportListResult> {
    if (query.status !== undefined && !PUBLIC_LISTABLE.has(query.status)) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'Status ini tidak dapat difilter pada daftar publik.',
        errors: [
          {
            field: 'status',
            code: 'not_public',
            message: 'Gunakan status yang tampil ke publik.',
          },
        ],
      });
    }
    const bbox = query.bbox === undefined ? null : parseBbox(query.bbox);
    if (query.bbox !== undefined && bbox === null) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'bbox tidak valid.',
        errors: [
          {
            field: 'bbox',
            code: 'invalid_bbox',
            message: 'bbox harus berisi minLon,minLat,maxLon,maxLat yang valid.',
          },
        ],
      });
    }
    const { items, hasMore } = await this.repository.listPublic({
      category: query.category ?? null,
      status: query.status ?? null,
      bbox,
      cursor: parseCursor(query.cursor),
      limit: query.limit,
    });
    return {
      items: items.map(toListItem),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async listInbox(
    query: PartnerInboxQuery,
    session: PartnerSession,
  ): Promise<ReportListResult> {
    const { items, hasMore } = await this.repository.listForInstitution(session.institutionId, {
      category: query.category ?? null,
      status: query.status ?? null,
      bbox: null,
      cursor: parseCursor(query.cursor),
      limit: query.limit,
    });
    return {
      items: items.map(toListItem),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async inboxDetail(publicId: string, session: PartnerSession): Promise<ReportDetail> {
    const report = await this.repository.findInInstitution(publicId, session.institutionId);
    if (report === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    const events = await this.repository.listEvents(report.id);
    return toDetail(report, events);
  }

  async listMine(query: MyReportsQuery, device: DeviceIdentity): Promise<ReportListResult> {
    assertDevice(device);
    const { items, hasMore } = await this.repository.listForDevice(
      device.hash,
      query.limit,
      parseCursor(query.cursor),
    );
    return {
      items: items.map(toListItem),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async publicDetail(publicId: string): Promise<ReportDetail> {
    const report = await this.repository.findPublicByPublicId(publicId);
    if (report === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    const events = await this.repository.listEvents(report.id);
    return toDetail(report, events);
  }

  async mineDetail(publicId: string, device: DeviceIdentity): Promise<ReportDetail> {
    assertDevice(device);
    const report = await this.repository.findByPublicIdForDevice(publicId, device.hash);
    if (report === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    const events = await this.repository.listEvents(report.id);
    return toDetail(report, events);
  }

  async corroborate(
    publicId: string,
    input: CorroborateInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<{ corroborationCount: number; alreadyCounted: boolean }> {
    assertDevice(device);
    const note = sanitizeNote(input.note);

    const result = await this.idempotency.execute(
      {
        scope: `report.corroborate.${device.hash}`,
        key,
        requestHash: idempotencyHash({ publicId, note }),
        ttlMs: IDEMPOTENCY_TTL_MS,
      },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        const reportId = await this.repository.findReportIdByPublicId(tx, publicId);
        if (reportId === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        const locked = await this.repository.lockReport(tx, reportId);
        if (locked === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        if (locked.deviceHash === device.hash) {
          await this.audit.denial({
            attempted: 'report.corroborate',
            reason: 'self_corroborate',
            objectType: 'report',
            objectId: publicId,
            actor: { kind: 'citizen', deviceHash: device.hash },
            requestId: context.requestId,
          });
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Laporan sendiri tidak perlu didukung.',
          });
        }
        if (locked.status === 'rejected' || locked.status === 'closed') {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Laporan ini sudah tidak menerima dukungan.',
          });
        }
        const outcome = await this.repository.addCorroboration(
          tx,
          reportId,
          device.hash,
          note,
        );
        if (outcome.inserted) {
          await this.recordEvent(
            tx,
            reportId,
            'corrected',
            { action: 'corroborate', count: outcome.count },
            { type: 'citizen', deviceHash: device.hash },
          );
        }
        return {
          status: 200,
          body: { corroborationCount: outcome.count, alreadyCounted: !outcome.inserted },
        };
      },
      context,
    );

    const corroborated = result.body as {
      corroborationCount: number;
      alreadyCounted: boolean;
    };
    await this.audit.record({
      action: 'report.corroborate',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'citizen', deviceHash: device.hash },
      requestId: context.requestId,
      payload: { alreadyCounted: corroborated.alreadyCounted },
    });
    return corroborated;
  }

  async verifyClosure(
    publicId: string,
    input: VerifyClosureInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<{ status: ReportStatus; recorded: boolean }> {
    assertDevice(device);
    const note = sanitizeNote(input.note);

    const result = await this.idempotency.execute(
      {
        scope: `report.closure.${device.hash}`,
        key,
        requestHash: idempotencyHash({ publicId, answer: input.answer, note }),
        ttlMs: IDEMPOTENCY_TTL_MS,
      },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        const reportId = await this.repository.findReportIdByPublicId(tx, publicId);
        if (reportId === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        const locked = await this.repository.lockReport(tx, reportId);
        if (locked === null) {
          throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
        }
        if (locked.status !== 'claimed_resolved') {
          throw new AppError('INVALID_TRANSITION', {
            detail:
              'Verifikasi penutupan hanya tersedia setelah instansi mengklaim selesai.',
          });
        }
        const participation = await this.repository.findParticipation(
          tx,
          reportId,
          device.hash,
        );
        if (!participation.reporter && !participation.corroborator) {
          await this.audit.denial({
            attempted: 'report.closure_verify',
            reason: 'not_a_participant',
            objectType: 'report',
            objectId: publicId,
            actor: { kind: 'citizen', deviceHash: device.hash },
            requestId: context.requestId,
          });
          throw new AppError('FORBIDDEN', {
            detail: 'Hanya pelapor atau pendukung yang dapat memverifikasi penutupan.',
          });
        }
        const next = statusAfterClosure(input.answer, new Date());
        await this.repository.recordClosure(tx, {
          reportId,
          deviceHash: device.hash,
          answer: input.answer,
          note,
          status: next.status,
          resolvedAt: next.resolvedAt,
        });
        await this.recordEvent(
          tx,
          reportId,
          next.status === 'verified_resolved' ? 'verified_resolved' : 'disputed',
          { answer: input.answer, hasNote: note !== null },
          { type: 'citizen', deviceHash: device.hash },
        );
        return { status: 200, body: { status: next.status, recorded: true } };
      },
      context,
    );

    const closure = result.body as { status: ReportStatus; recorded: boolean };
    await this.audit.record({
      action: 'report.closure_verify',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'citizen', deviceHash: device.hash },
      requestId: context.requestId,
      payload: { answer: input.answer, status: closure.status },
    });
    return closure;
  }

  async partnerAction(
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
        scope: `report.partner.${session.userId}`,
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
        const locked = await this.repository.lockReportInInstitution(
          tx,
          reportId,
          institutionId,
        );
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
          { type: 'partner', id: session.userId },
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
