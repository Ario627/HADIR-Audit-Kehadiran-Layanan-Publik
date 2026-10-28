import type { Direction, Estimate, EstimateMetrics, EvidenceLevel } from '@hadir/contracts';

export type EstimateWindow = '7d' | '30d';

export interface EstimateStatus {
  key: 'no_excess' | 'none' | 'indication' | 'strong' | 'field_verified';
  label: string;
  detail: string;
}

export interface EstimateReadout {
  kind: 'empty' | 'insufficient' | 'measured';
  n: number;
  minutes: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  ciLevel: number | null;
  message: string;
}

export interface PromiseComparison {
  thresholdMin: number;
  gapMin: number;
  direction: Direction;
}

export interface WarningText {
  code: string;
  text: string;
}

const STATUS = new Map<EstimateStatus['key'], EstimateStatus>([
  [
    'no_excess',
    {
      key: 'no_excess',
      label: 'Tidak ada kelebihan terdeteksi',
      detail:
        'Seluruh interval kepercayaan berada di bawah ambang. Ini bukan bukti layanan patuh sepenuhnya, hanya tidak ada kelebihan yang terukur.',
    },
  ],
  [
    'none',
    {
      key: 'none',
      label: 'Belum cukup data',
      detail: 'Jumlah episode, hari, atau klaster belum memenuhi ambang minimum.',
    },
  ],
  [
    'indication',
    {
      key: 'indication',
      label: 'Indikasi',
      detail: 'Ada pola yang terlihat, tetapi syarat bukti kuat belum terpenuhi.',
    },
  ],
  [
    'strong',
    {
      key: 'strong',
      label: 'Bukti kuat',
      detail: 'Jumlah episode, keragaman perangkat, dan klaster memenuhi ambang.',
    },
  ],
  [
    'field_verified',
    {
      key: 'field_verified',
      label: 'Terverifikasi lapangan',
      detail: 'Diperiksa pengamat terlatih di lokasi.',
    },
  ],
]);

const WARNING_TEXT = new Map<string, string>([
  ['no_data', 'Belum ada catatan yang layak pada jendela waktu ini.'],
  ['small_n', 'Jumlah episode masih di bawah ambang minimum.'],
  ['small_cluster_count', 'Klaster (hari-jam per halte) terlalu sedikit untuk interval yang stabil.'],
  ['clustered_data', 'Data sangat mengelompok, sehingga jumlah efektif lebih kecil dari jumlah episode.'],
  ['p95_unstable', 'Persentil ke-95 belum stabil pada sebagian sampel bootstrap.'],
  ['trust_sensitive', 'Hasil berubah bila episode berbobot rendah dikeluarkan.'],
  ['low_trust_dominant', 'Sebagian besar bobot berasal dari episode dengan kehadiran belum terverifikasi.'],
]);

const MINUTE_DIGITS = 0;

export function isEstimateWindow(value: unknown): value is EstimateWindow {
  return value === '7d' || value === '30d';
}

export function readEstimateWindow(value: unknown): EstimateWindow {
  return value === '30d' ? '30d' : '7d';
}

export function windowLabel(window: EstimateWindow): string {
  return window === '7d' ? '7 hari terakhir' : '30 hari terakhir';
}

export function estimateStatus(evidence: EvidenceLevel, direction: Direction): EstimateStatus {
  const key: EstimateStatus['key'] = direction === 'no_excess' ? 'no_excess' : evidence;
  const status = STATUS.get(key);
  if (status === undefined) {
    throw new Error(`Status estimasi tidak dikenal: ${key}`);
  }
  return status;
}

function metricsOf(estimate: Pick<Estimate, 'metrics' | 'warnings' | 'message'>): EstimateReadout {
  const { metrics, warnings, message } = estimate;
  const n = metrics.n;
  if (n === 0) {
    return { kind: 'empty', n, minutes: null, ciLow: null, ciHigh: null, ciLevel: null, message };
  }
  if (metrics.medianMin === null || warnings.includes('small_n')) {
    return { kind: 'insufficient', n, minutes: null, ciLow: null, ciHigh: null, ciLevel: null, message };
  }
  return {
    kind: 'measured',
    n,
    minutes: metrics.medianMin,
    ciLow: metrics.ci?.low ?? null,
    ciHigh: metrics.ci?.high ?? null,
    ciLevel: metrics.ci?.level ?? null,
    message,
  };
}

export function estimateReadout(estimate: Estimate): EstimateReadout {
  return metricsOf(estimate);
}

export function medianText(readout: EstimateReadout): string {
  if (readout.minutes === null) {
    return '—';
  }
  return `${Math.round(readout.minutes)}`;
}

export function ciText(readout: EstimateReadout): string | null {
  if (readout.ciLow === null || readout.ciHigh === null || readout.ciLevel === null) {
    return null;
  }
  const percent = Math.round(readout.ciLevel * 100);
  const low = Math.round(readout.ciLow);
  const high = Math.round(readout.ciHigh);
  return `Interval ${percent}%: ${low}–${high} menit`;
}

export function sampleText(metrics: EstimateMetrics, days: number, devices: number): string {
  return `n=${metrics.n} · ${days} hari · ${devices} perangkat`;
}

export function compareToPromise(estimate: Estimate): PromiseComparison | null {
  const thresholdMin = estimate.sample.thresholdMin;
  const median = estimate.metrics.medianMin;
  if (thresholdMin === null || median === null) {
    return null;
  }
  const gap = median - thresholdMin;
  const rounded = Math.sign(gap) * (Math.round(Math.abs(gap) * 10) / 10);
  return {
    thresholdMin,
    gapMin: Object.is(rounded, -0) ? 0 : rounded,
    direction: estimate.direction,
  };
}

export function gapText(comparison: PromiseComparison): string {
  const magnitude = Math.abs(comparison.gapMin);
  const rounded = magnitude < 1 ? 'kurang dari 1' : `${Math.round(magnitude)}`;
  if (comparison.gapMin > 0) {
    return `${rounded} menit di atas ambang`;
  }
  if (comparison.gapMin < 0) {
    return `${rounded} menit di bawah ambang`;
  }
  return 'tepat pada ambang';
}

export function knownWarnings(codes: readonly string[]): WarningText[] {
  const output: WarningText[] = [];
  for (const code of codes) {
    const text = WARNING_TEXT.get(code);
    if (text !== undefined) {
      output.push({ code, text });
    }
  }
  return output;
}

export function unknownWarnings(codes: readonly string[]): string[] {
  return codes.filter((code) => !WARNING_TEXT.has(code));
}

export function formatMinuteValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: MINUTE_DIGITS }).format(value);
}

export function rateText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return '—';
  }
  return `${new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(value * 100)}%`;
}