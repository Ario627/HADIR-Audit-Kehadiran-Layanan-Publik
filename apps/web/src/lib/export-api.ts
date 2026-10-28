import type {
  PartnerExportDetail,
  PartnerExportTicket,
  ReportCategory,
  ReportStatus,
} from '@hadir/contracts';
import { queryOptions } from '@tanstack/react-query';
import type { PayloadSchema } from './api';
import { apiSendChecked } from './api';
import { isRecord, readIsoDateTime, readNullableText, readText } from './guards';
import { isUuid } from './id';

const PARTNER = '/v1/partner';
const DOWNLOAD_PREFIX = '/v1/partner/exports/';
const MAX_LIST = 50;
const PAGE_LIMIT = 20;
const FORMATS = new Set(['csv', 'open311']);
const STATUSES = new Set(['queued', 'running', 'ready', 'failed', 'expired']);

function hasUnsafeChars(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || char === '\\') {
      return true;
    }
  }
  return false;
}

function toDownloadUrl(raw: unknown): string | null | undefined {
  if (raw === null) {
    return null;
  }
  const text = readText(raw, 500);
  if (text === null) {
    return undefined;
  }
  if (!text.startsWith(DOWNLOAD_PREFIX) || text.startsWith('//') || hasUnsafeChars(text)) {
    return undefined;
  }
  return text;
}

function toNullableCount(raw: unknown, max: number): number | null | undefined {
  if (raw === null) {
    return null;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > max) {
    return undefined;
  }
  return raw;
}

function toExportDetail(value: unknown): PartnerExportDetail | null {
  if (!isRecord(value)) {
    return null;
  }
  const exportId = readText(value.exportId, 36);
  if (exportId === null || !isUuid(exportId)) {
    return null;
  }
  if (typeof value.format !== 'string' || !FORMATS.has(value.format)) {
    return null;
  }
  if (typeof value.status !== 'string' || !STATUSES.has(value.status)) {
    return null;
  }
  const rowCount = toNullableCount(value.rowCount, 100_000_000);
  const byteSize = toNullableCount(value.byteSize, 1_000_000_000);
  if (rowCount === undefined || byteSize === undefined) {
    return null;
  }
  const downloadUrl = toDownloadUrl(value.downloadUrl);
  if (downloadUrl === undefined) {
    return null;
  }
  const expiresAt = readNullableText(value.expiresAt, 40);
  const createdAt = readIsoDateTime(value.createdAt);
  if (expiresAt === undefined || createdAt === null) {
    return null;
  }
  if (expiresAt !== null && Number.isNaN(Date.parse(expiresAt))) {
    return null;
  }
  return {
    exportId,
    status: value.status as PartnerExportDetail['status'],
    format: value.format as PartnerExportDetail['format'],
    rowCount,
    byteSize,
    downloadUrl,
    expiresAt,
    createdAt,
  };
}

function toExportTicket(value: unknown): PartnerExportTicket | null {
  if (!isRecord(value)) {
    return null;
  }
  const exportId = readText(value.exportId, 36);
  const createdAt = readIsoDateTime(value.createdAt);
  if (exportId === null || !isUuid(exportId) || createdAt === null) {
    return null;
  }
  if (typeof value.format !== 'string' || !FORMATS.has(value.format)) {
    return null;
  }
  if (typeof value.status !== 'string' || !STATUSES.has(value.status)) {
    return null;
  }
  return {
    exportId,
    status: value.status as PartnerExportTicket['status'],
    format: value.format as PartnerExportTicket['format'],
    createdAt,
  };
}

function toExportList(value: unknown): PartnerExportDetail[] | null {
  if (!isRecord(value) || !Array.isArray(value.items)) {
    return null;
  }
  if (value.items.length > MAX_LIST) {
    return null;
  }
  const items: PartnerExportDetail[] = [];
  for (const entry of value.items) {
    const item = toExportDetail(entry);
    if (item === null) {
      return null;
    }
    items.push(item);
  }
  return items;
}

export interface CreateExportInput {
  format: PartnerExportDetail['format'];
  from?: string;
  to?: string;
  category?: ReportCategory;
  status?: ReportStatus;
}

export const exportTicketSchema: PayloadSchema<PartnerExportTicket> = {
  safeParse(value) {
    const ticket = toExportTicket(value);
    return ticket === null ? { success: false } : { success: true, data: ticket };
  },
};

export const exportDetailSchema: PayloadSchema<PartnerExportDetail> = {
  safeParse(value) {
    const detail = toExportDetail(value);
    return detail === null ? { success: false } : { success: true, data: detail };
  },
};

export const exportListSchema: PayloadSchema<PartnerExportDetail[]> = {
  safeParse(value) {
    const items = toExportList(value);
    return items === null ? { success: false } : { success: true, data: items };
  },
};

export function exportListQuery() {
  return queryOptions({
    queryKey: ['partner', 'exports'] as const,
    queryFn: async (): Promise<PartnerExportDetail[]> =>
      (
        await apiSendChecked(`${PARTNER}/exports?limit=${PAGE_LIMIT}`, exportListSchema, {
          method: 'GET',
        })
      ).data,
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export function exportDetailQuery(exportId: string) {
  return queryOptions({
    queryKey: ['partner', 'export', exportId] as const,
    queryFn: async (): Promise<PartnerExportDetail> =>
      (
        await apiSendChecked(
          `${PARTNER}/exports/${encodeURIComponent(exportId)}`,
          exportDetailSchema,
          { method: 'GET' },
        )
      ).data,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: exportId.length > 0,
  });
}

export async function createExport(input: CreateExportInput): Promise<PartnerExportTicket> {
  return (
    await apiSendChecked(`${PARTNER}/exports`, exportTicketSchema, {
      method: 'POST',
      body: input,
    })
  ).data;
}