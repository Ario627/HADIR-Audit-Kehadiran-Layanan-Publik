import type { ReportCategory, ReportDetail, ReportStatus } from '@hadir/contracts';

export const REPORT_MIN_TEXT = 20;
export const REPORT_MAX_TEXT = 2_000;

const CATEGORY_LABELS = new Map<ReportCategory, string>([
  ['service_wait', 'Tunggu terlalu lama'],
  ['service_no_show', 'Bus tidak datang'],
  ['service_full', 'Bus penuh'],
  ['stop_facility', 'Halte rusak'],
  ['stop_cleanliness', 'Halte kotor'],
  ['stop_safety', 'Keamanan halte'],
  ['route_info', 'Informasi rute'],
  ['accessibility', 'Aksesibilitas'],
  ['other', 'Lainnya'],
]);

const CATEGORY_HINTS = new Map<ReportCategory, string>([
  ['service_wait', 'Bus datang, tetapi jauh melewati janji headway.'],
  ['service_no_show', 'Bus tidak muncul sama sekali pada jam layanan.'],
  ['service_full', 'Bus datang dan tidak berhenti karena sudah penuh.'],
  ['stop_facility', 'Bangunan, atap, kursi, atau penerangan halte rusak.'],
  ['stop_cleanliness', 'Sampah, bau, atau genangan di area halte.'],
  ['stop_safety', 'Penerangan gelap, tidak ada petugas, atau rawan kecelakaan.'],
  ['route_info', 'Papan rute hilang, salah, atau tidak terbaca.'],
  ['accessibility', 'Halangan untuk pengguna kursi roda, lansia, atau tunanetra.'],
  ['other', 'Hal lain yang tidak masuk kategori di atas.'],
]);

const STATUS_LABELS = new Map<ReportStatus, string>([
  ['draft', 'Draf'],
  ['submitted', 'Terkirim'],
  ['triaged', 'Sudah diperiksa'],
  ['acknowledged', 'Diterima instansi'],
  ['in_progress', 'Sedang ditangani'],
  ['claimed_resolved', 'Diklaim selesai'],
  ['verified_resolved', 'Selesai terverifikasi'],
  ['disputed', 'Diperdebatkan'],
  ['rejected', 'Ditolak'],
  ['closed', 'Ditutup'],
]);

const MODERATION_LABELS = new Map<ReportDetail['moderation'], string>([
  ['pending', 'Menunggu moderasi'],
  ['approved', 'Lolos moderasi'],
  ['rejected', 'Tidak lolos moderasi'],
  ['quarantined', 'Dikarantina'],
]);

const EVENT_LABELS = new Map<string, string>([
  ['submitted', 'Laporan dikirim'],
  ['triaged', 'Pemeriksaan awal'],
  ['acknowledged', 'Diterima instansi'],
  ['info_requested', 'Instansi meminta keterangan'],
  ['scheduled', 'Dijadwalkan'],
  ['responded', 'Instansi menanggapi'],
  ['claimed_resolved', 'Instansi mengklaim selesai'],
  ['verified_resolved', 'Warga memverifikasi selesai'],
  ['disputed', 'Warga membantah klaim'],
  ['rejected', 'Ditolak'],
  ['moderated', 'Moderasi'],
  ['corrected', 'Diperbarui'],
]);

const WARNING_TEXT = new Map<string, string>([
  ['photo_upload_ignored', 'Lampiran foto belum tersedia, jadi laporan dikirim tanpa foto.'],
  ['contact_email_ignored', 'Email tidak disimpan, jadi tidak ada kabar lewat email.'],
]);

export const REPORT_CATEGORIES: readonly ReportCategory[] = [
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
];

export type ReportTextIssue = 'too_short';

export interface ReportTextCheck {
  text: string;
  length: number;
  issue: ReportTextIssue | null;
}

export type StatusTone = 'neutral' | 'progress' | 'verified' | 'alert';

function isPrintable(code: number): boolean {
  if (code === 9 || code === 10 || code === 13) {
    return true;
  }
  return code >= 32 && code !== 127;
}

export function sanitizeReportText(raw: string): string {
  let printable = '';
  for (const character of raw) {
    if (isPrintable(character.codePointAt(0) ?? 0)) {
      printable += character;
    }
  }
  return printable
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

export function checkReportText(raw: string): ReportTextCheck {
  const text = sanitizeReportText(raw);
  return {
    text,
    length: text.length,
    issue: text.length < REPORT_MIN_TEXT ? 'too_short' : null,
  };
}

export function isReportCategory(value: unknown): value is ReportCategory {
  return typeof value === 'string' && CATEGORY_LABELS.has(value as ReportCategory);
}

export function readReportCategory(value: unknown): ReportCategory | null {
  return isReportCategory(value) ? value : null;
}

export function categoryLabel(category: ReportCategory): string {
  return CATEGORY_LABELS.get(category) ?? 'Lainnya';
}

export function categoryHint(category: ReportCategory): string {
  return CATEGORY_HINTS.get(category) ?? '';
}

export function statusLabel(status: ReportStatus): string {
  return STATUS_LABELS.get(status) ?? status;
}

export function moderationLabel(moderation: ReportDetail['moderation']): string {
  return MODERATION_LABELS.get(moderation) ?? moderation;
}

export function eventLabel(kind: string): string {
  return EVENT_LABELS.get(kind) ?? 'Pembaruan';
}

export function warningText(code: string): string | null {
  return WARNING_TEXT.get(code) ?? null;
}

export function statusTone(status: ReportStatus): StatusTone {
  if (status === 'verified_resolved') {
    return 'verified';
  }
  if (status === 'rejected' || status === 'disputed') {
    return 'alert';
  }
  if (status === 'submitted' || status === 'triaged' || status === 'acknowledged') {
    return 'progress';
  }
  return 'neutral';
}

export function acceptsCorroboration(status: ReportStatus): boolean {
  return status !== 'rejected' && status !== 'closed' && status !== 'draft';
}

export function needsCitizenClosure(status: ReportStatus): boolean {
  return status === 'claimed_resolved';
}

export function isTerminalStatus(status: ReportStatus): boolean {
  return status === 'verified_resolved' || status === 'rejected' || status === 'closed';
}

const OWN_REPORTS_KEY = 'hadir.reports.v1';
const OWN_REPORTS_LIMIT = 20;
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{6,40}$/;

function ownStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function decodeOwnReports(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of parsed) {
    if (typeof entry === 'string' && PUBLIC_ID_PATTERN.test(entry)) {
      ids.push(entry);
    }
  }
  return ids.slice(0, OWN_REPORTS_LIMIT);
}

export function readOwnReports(): string[] {
  const store = ownStorage();
  if (store === null) {
    return [];
  }
  try {
    return decodeOwnReports(store.getItem(OWN_REPORTS_KEY));
  } catch {
    return [];
  }
}

export function rememberOwnReport(publicId: string): void {
  if (!PUBLIC_ID_PATTERN.test(publicId)) {
    return;
  }
  const store = ownStorage();
  if (store === null) {
    return;
  }
  const next = [publicId, ...readOwnReports().filter((id) => id !== publicId)].slice(
    0,
    OWN_REPORTS_LIMIT,
  );
  try {
    store.setItem(OWN_REPORTS_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

export function clearOwnReports(): void {
  const store = ownStorage();
  if (store === null) {
    return;
  }
  try {
    store.removeItem(OWN_REPORTS_KEY);
  } catch {
    return;
  }
}

export function isOwnReport(publicId: string): boolean {
  return readOwnReports().includes(publicId);
}

export function readPublicId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return PUBLIC_ID_PATTERN.test(trimmed) ? trimmed : null;
}