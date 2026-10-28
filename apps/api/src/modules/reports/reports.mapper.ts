import type { ReportDetail, ReportListItem } from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import type { DeviceIdentity } from '../../common/http/request-context';
import type {
  EventRecord,
  ReportRow,
  StoredReportStatus,
} from '../../db/repositories/reports.repository';

export interface ReportListResult {
  items: ReportListItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

export function assertDevice(device: DeviceIdentity): void {
  if (device.isNew) {
    throw new AppError('UNAUTHENTICATED', {
      detail: 'Panggil POST /v1/devices sebelum mengirim laporan.',
    });
  }
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

export function statusAfterClosure(
  answer: 'yes' | 'no' | 'partial',
  now: Date,
): { status: StoredReportStatus; resolvedAt: Date | null } {
  return answer === 'yes'
    ? { status: 'verified_resolved', resolvedAt: now }
    : { status: 'disputed', resolvedAt: null };
}

function buildDetail(
  row: ReportRow,
  events: readonly EventRecord[],
  includeNotes: boolean,
): ReportDetail {
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
      note: includeNotes ? event.note : null,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

export function toDetail(row: ReportRow, events: readonly EventRecord[]): ReportDetail {
  return buildDetail(row, events, true);
}

export function toPublicDetail(row: ReportRow, events: readonly EventRecord[]): ReportDetail {
  return buildDetail(row, events, false);
}
