import type { Runway, RunwayEvent, RunwayStatus, UrgencyBand } from '@hadir/contracts';

export const TAPE_HORIZON_DAYS = 180;
export const TAPE_TICK_DAYS = 30;

export type UrgencyTone = 'alert' | 'attention' | 'neutral' | 'ok';

export interface UrgencyView {
  band: UrgencyBand;
  label: string;
  detail: string;
  tone: UrgencyTone;
}

const URGENCY = new Map<UrgencyBand, UrgencyView>([
  [
    'expired',
    {
      band: 'expired',
      label: 'Lewat batas pendanaan',
      detail: 'Tanggal pendanaan yang dilaporkan sudah lewat. Bukan prediksi penghentian layanan.',
      tone: 'alert',
    },
  ],
  [
    'critical',
    {
      band: 'critical',
      label: 'Mendesak',
      detail: 'Sisa waktu pendanaan paling pendek di antara koridor yang dipantau.',
      tone: 'alert',
    },
  ],
  [
    'warning',
    {
      band: 'warning',
      label: 'Perlu perhatian',
      detail: 'Sisa waktu pendanaan mulai tipis menurut ambang yang dipakai.',
      tone: 'attention',
    },
  ],
  [
    'watch',
    {
      band: 'watch',
      label: 'Dipantau',
      detail: 'Masih ada waktu, tetapi tanggalnya perlu diperiksa berkala.',
      tone: 'neutral',
    },
  ],
  [
    'none',
    {
      band: 'none',
      label: 'Tanpa tenggat',
      detail: 'Tidak ada batas pendanaan yang dilaporkan untuk periode ini.',
      tone: 'ok',
    },
  ],
]);

const STATUS = new Map<RunwayStatus, string>([
  ['funded', 'Dana terjamin'],
  ['pending', 'Menunggu keputusan'],
  ['stopped', 'Dihentikan'],
  ['unknown', 'Tidak diketahui'],
]);

const EVENT_KINDS = new Map<string, string>([
  ['announced', 'Diumumkan'],
  ['budget_decided', 'Anggaran diputuskan'],
  ['funded', 'Dana dicairkan'],
  ['suspended', 'Ditangguhkan'],
  ['resumed', 'Dilanjutkan'],
  ['stopped', 'Dihentikan'],
  ['corrected', 'Dikoreksi'],
]);

export function urgencyOf(band: UrgencyBand): UrgencyView {
  const view = URGENCY.get(band);
  if (view === undefined) {
    throw new Error(`Band urgensi tidak dikenal: ${band}`);
  }
  return view;
}

export function runwayStatusLabel(status: RunwayStatus): string {
  return STATUS.get(status) ?? 'Tidak diketahui';
}

export function eventKindLabel(kind: string): string {
  return EVENT_KINDS.get(kind) ?? 'Pembaruan';
}

export function daysRemainingText(days: number | null): string {
  if (days === null) {
    return 'Tidak diketahui';
  }
  if (days < 0) {
    return `Lewat ${Math.abs(days)} hari`;
  }
  if (days === 0) {
    return 'Berakhir hari ini';
  }
  return `${days} hari lagi`;
}

export function tapeMarker(daysRemaining: number | null): number | null {
  if (daysRemaining === null || !Number.isFinite(daysRemaining)) {
    return null;
  }
  const clamped = Math.min(Math.max(daysRemaining, 0), TAPE_HORIZON_DAYS);
  return Math.round((clamped / TAPE_HORIZON_DAYS) * 1000) / 10;
}

export function tapeTicks(): number[] {
  const count = Math.floor(TAPE_HORIZON_DAYS / TAPE_TICK_DAYS);
  const ticks: number[] = [];
  for (let index = 0; index <= count; index += 1) {
    ticks.push(Math.round((index / count) * 1000) / 10);
  }
  return ticks;
}

export function decisionText(runway: Runway): string | null {
  const date = runway.decisionDate;
  const doc = runway.decisionDoc;
  if (date === null && doc === null) {
    return null;
  }
  if (date === null) {
    return `Keputusan: ${doc}`;
  }
  if (doc === null) {
    return `Keputusan tertanggal ${date}`;
  }
  return `Keputusan ${date}: ${doc}`;
}

export function sortedEvents(events: readonly RunwayEvent[]): RunwayEvent[] {
  return [...events].sort((left, right) => left.seq - right.seq);
}

export function horizonNote(): string {
  return `Pita menampilkan ${TAPE_HORIZON_DAYS} hari ke depan sebagai skala baca, bukan ramalan.`;
}