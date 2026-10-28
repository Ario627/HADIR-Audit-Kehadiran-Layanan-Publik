import type { AnalyticsBucket, PartnerAnalytics } from '@hadir/contracts';

export const K_THRESHOLD = 5;
export const MIN_MEDIAN_SAMPLE = 10;
export const DEFAULT_WINDOW_DAYS = 30;
export const MAX_WINDOW_DAYS = 180;

export function totalNote(totalReports: number | null, suppressed: boolean): string | null {
  if (suppressed) {
    return `Jumlah laporan disembunyikan karena di bawah ${K_THRESHOLD} laporan pada rentang ini. Menampilkannya akan membuat laporan individu mudah ditebak.`;
  }
  if (totalReports === null) {
    return 'Jumlah laporan tidak bisa dihitung untuk rentang ini.';
  }
  if (totalReports === 0) {
    return 'Tidak ada laporan pada rentang ini.';
  }
  return null;
}

export function medianNote(totalReports: number | null, suppressed: boolean): string | null {
  if (suppressed || totalReports === null) {
    return 'Median disembunyikan bersama jumlah totalnya.';
  }
  if (totalReports < MIN_MEDIAN_SAMPLE) {
    return `Median baru ditampilkan setelah ${MIN_MEDIAN_SAMPLE} laporan pada rentang ini; sekarang ${totalReports}.`;
  }
  return null;
}

export function rateNote(totalReports: number | null, suppressed: boolean): string | null {
  if (suppressed || totalReports === null) {
    return 'Rasio disembunyikan bersama jumlah totalnya.';
  }
  if (totalReports < K_THRESHOLD) {
    return `Rasio baru ditampilkan setelah ${K_THRESHOLD} laporan pada rentang ini.`;
  }
  return null;
}

export function suppressedBuckets(buckets: readonly AnalyticsBucket[]): number {
  return buckets.filter((bucket) => bucket.suppressed).length;
}

export function bucketNote(buckets: readonly AnalyticsBucket[]): string | null {
  const hidden = suppressedBuckets(buckets);
  if (hidden === 0) {
    return null;
  }
  return `${hidden} kelompok disembunyikan karena jumlahnya di bawah ${K_THRESHOLD}.`;
}

export function windowDaysLabel(days: number): string {
  return days === 1 ? '1 hari' : `${days} hari`;
}

export function windowSpanNote(
  analytics: PartnerAnalytics,
  requestedDays: number | null,
): string | null {
  if (requestedDays === null) {
    return null;
  }
  const actual = analytics.window.days;
  if (actual >= requestedDays) {
    return null;
  }
  return `Server memotong rentang menjadi ${windowDaysLabel(actual)} karena batas maksimum ${MAX_WINDOW_DAYS} hari.`;
}

export function hasAnyBucket(buckets: readonly AnalyticsBucket[]): boolean {
  return buckets.some((bucket) => bucket.count !== null || !bucket.suppressed);
}