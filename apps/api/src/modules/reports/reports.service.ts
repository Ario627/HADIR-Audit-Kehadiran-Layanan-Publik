import { Inject, Injectable } from '@nestjs/common';
import type {
  CorroborateInput,
  CreateReportInput,
  ListReportsQuery,
  MyReportsQuery,
  ReportCategory,
  ReportDetail,
  ReportStatus,
  VerifyClosureInput,
} from '@hadir/contracts';
import { AuditService } from '../../common/audit/audit.service';
import { AppError } from '../../common/errors/app-error';
import { parseBbox } from '../../common/geo/bbox';
import { idempotencyHash } from '../../common/http/idempotency-key';
import type { DeviceIdentity } from '../../common/http/request-context';
import {
  IdempotencyService,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { nextPublicId } from '../../common/id/public-id';
import type { Transaction } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import {
  ReportsRepository,
  evidenceScore,
  type StoredEventKind,
} from '../../db/repositories/reports.repository';
import { UploadsService } from '../uploads/uploads.service';
import { contactCipher, encodeContactEmail } from './reports.contact';
import { nextCursorOf, parseCursor, PUBLIC_LISTABLE } from './reports.cursor';
import {
  assertDevice,
  statusAfterClosure,
  toDetail,
  toListItem,
  toPublicDetail,
  type ReportListResult,
} from './reports.mapper';
import { assertUsableText, sanitizeNote } from './reports.text';

const IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SERVICE_CATEGORIES: ReadonlySet<ReportCategory> = new Set<ReportCategory>([
  'service_wait',
  'service_no_show',
  'service_full',
]);

export interface CreateReportResult {
  report: ReportDetail;
  warnings: string[];
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly repository: ReportsRepository,
    private readonly devices: DevicesRepository,
    private readonly idempotency: IdempotencyService,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
    private readonly uploads: UploadsService,
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
    const contact = encodeContactEmail(input.contactEmail, contactCipher());
    if (input.photoUploadId !== undefined && input.photoUploadId !== null) {
      warnings.push('photo_pending_review');
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
          institutionId: authorityId,
          contactEmailEnc: contact === null ? null : contact.enc,
          contactEmailHash: contact === null ? null : contact.hash,
          evidenceScore: evidenceScore({
            hasStop: true,
            hasPlanMatch: verdict === 'already_planned',
            corroborations: 0,
            measurableCategory: SERVICE_CATEGORIES.has(input.category),
          }),
          evidenceLevel: 'none',
        });
        if (input.photoUploadId !== undefined && input.photoUploadId !== null) {
          await this.uploads.claimForReport(tx, input.photoUploadId, report.id, device.hash);
        }
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
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listPublic(tx, {
          category: query.category ?? null,
          status: query.status ?? null,
          bbox,
          cursor: parseCursor(query.cursor),
          limit: query.limit,
        }),
      { scope: 'public', requestId: 'public-read' },
    );
    return {
      items: items.map(toListItem),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async listMine(query: MyReportsQuery, device: DeviceIdentity): Promise<ReportListResult> {
    assertDevice(device);
    const { items, hasMore } = await this.run(
      (tx) =>
        this.repository.listForDevice(tx, device.hash, query.limit, parseCursor(query.cursor)),
      { deviceHash: device.hash, requestId: 'citizen-read' },
    );
    return {
      items: items.map(toListItem),
      nextCursor: nextCursorOf(items, hasMore),
      hasMore,
    };
  }

  async publicDetail(publicId: string): Promise<ReportDetail> {
    const loaded = await this.run(
      async (tx) => {
        const report = await this.repository.findPublicByPublicId(tx, publicId);
        if (report === null) {
          return null;
        }
        const events = await this.repository.listEventsFor(tx, report.id);
        return { report, events };
      },
      { scope: 'public', requestId: 'public-read' },
    );
    if (loaded === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    return toPublicDetail(loaded.report, loaded.events);
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
}
