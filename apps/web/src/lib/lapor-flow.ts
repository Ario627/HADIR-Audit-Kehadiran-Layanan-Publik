import type { ReportCategory } from '@hadir/contracts';
import { dedupeIssues, type FieldIssue } from './form-errors';
import { reportFormIssues, REPORT_MAX_TEXT, REPORT_MIN_TEXT } from './report';

export const ACK_FIELD_ID = 'publikasi-ack';
export const CHECK_MIN = REPORT_MIN_TEXT;
export const CHECK_MAX = REPORT_MAX_TEXT;

const DRAFT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readDraftId(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return DRAFT_ID_PATTERN.test(trimmed) ? trimmed : null;
}

export function draftPath(draftId: string): string {
  return `/lapor/${draftId}`;
}

export interface DetailInput {
  stopCode: string | null;
  category: ReportCategory | null;
  text: string;
  acknowledged: boolean;
}

export function detailIssues(input: DetailInput): FieldIssue[] {
  const base = reportFormIssues({
    stopCode: input.stopCode,
    category: input.category,
    text: input.text,
  });
  const issues = [...base];
  if (!input.acknowledged) {
    issues.push({
      field: ACK_FIELD_ID,
      label: 'Persetujuan publikasi',
      message:
        'Centang pernyataan publikasi supaya kamu tahu laporan ini terbaca publik setelah moderasi.',
    });
  }
  return dedupeIssues(issues);
}

export function canSubmitDetail(input: DetailInput): boolean {
  return detailIssues(input).length === 0;
}

export function readOnlyLabel(code: string, name: string | null): string {
  return name === null ? code : `${code} · ${name}`;
}