import type { PartnerExportDetail } from '@hadir/contracts';

export type PartnerExportFormat = PartnerExportDetail['format'];
export type PartnerExportStatus = PartnerExportDetail['status'];

export const EXPORT_ROW_LIMIT = 5_000;
export const EXPORT_HOURLY_LIMIT = 5;
export const EXPORT_TTL_HOURS = 24;
export const SIGNED_URL_TTL_MINUTES = 10;

export const EXPORT_FORMATS: readonly PartnerExportFormat[] = ['csv', 'open311'];

const FORMAT_LABELS: Record<PartnerExportFormat, string> = {
  csv: 'CSV',
  open311: 'Open311 JSON',
};

const FORMAT_HINTS: Record<PartnerExportFormat, string> = {
  csv: 'Satu baris per laporan, dipisah koma. Cocok untuk Excel atau Google Sheets.',
  open311:
    'Format JSON Open311 GeoReport v2. Cocok kalau instansimu sudah memakai sistem pengaduan Open311.',
};

const STATUS_LABELS: Record<PartnerExportStatus, string> = {
  queued: 'Menunggu antrean',
  running: 'Sedang disiapkan',
  ready: 'Siap diunduh',
  failed: 'Gagal disiapkan',
  expired: 'Sudah kedaluwarsa',
};

const EXTENSION: Record<PartnerExportFormat, string> = {
  csv: 'csv',
  open311: 'json',
};

const ID_PATTERN = /^[A-Za-z0-9-]{6,36}$/;

export function exportFormatLabel(format: PartnerExportFormat): string {
  return FORMAT_LABELS[format];
}

export function exportFormatHint(format: PartnerExportFormat): string {
  return FORMAT_HINTS[format];
}

export function exportStatusLabel(status: PartnerExportStatus): string {
  return STATUS_LABELS[status];
}

export function isDownloadable(detail: PartnerExportDetail): boolean {
  return detail.status === 'ready' && detail.downloadUrl !== null;
}

export function formatByteSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return 'ukuran tidak dilaporkan';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} kB`;
  }
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export function formatRowCount(rows: number | null): string {
  if (rows === null || !Number.isFinite(rows) || rows < 0) {
    return 'jumlah baris tidak dilaporkan';
  }
  return `${new Intl.NumberFormat('id-ID').format(Math.floor(rows))} baris`;
}

export function exportFilename(format: PartnerExportFormat, exportId: string): string {
  const safe = ID_PATTERN.test(exportId) ? exportId.slice(0, 8) : 'berkas';
  return `hadir-ekspor-${safe}.${EXTENSION[format]}`;
}

export function saveBlob(blob: Blob, filename: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
  return true;
}

export function exportRowLimitNote(): string {
  return `Satu berkas memuat paling banyak ${new Intl.NumberFormat('id-ID').format(EXPORT_ROW_LIMIT)} baris. Kalau laporan instansimu lebih banyak, sempitkan rentang tanggal atau saringan kategori.`;
}

export function exportQuotaNote(): string {
  return `Maksimal ${EXPORT_HOURLY_LIMIT} ekspor per jam per instansi. Berkas bisa diunduh selama ${EXPORT_TTL_HOURS} jam, dan setiap tautan unduh berlaku ${SIGNED_URL_TTL_MINUTES} menit.`;
}

export function formatOptions(): readonly PartnerExportFormat[] {
  return EXPORT_FORMATS;
}