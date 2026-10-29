import type { ReportStatus } from '@hadir/contracts';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';
import type { ReportRow } from '../../db/repositories/reports.repository';

export const PUBLIC_LISTABLE: ReadonlySet<ReportStatus> = new Set<ReportStatus>([
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
]);

export interface CursorValue {
  createdAt: Date;
  id: string;
}

export function parseCursor(raw: string | undefined): CursorValue | null {
  if (raw === undefined) {
    return null;
  }
  const decoded = decodeCursor(raw);
  return { createdAt: decoded.createdAt, id: decoded.id };
}

export function nextCursorOf(items: readonly ReportRow[], hasMore: boolean): string | null {
  const last = items[items.length - 1];
  if (!hasMore || last === undefined) {
    return null;
  }
  return encodeCursor({ createdAt: last.createdAt, id: last.id });
}
