import type { Episode, EpisodeOutcome, Presence, StartMode } from '@hadir/contracts';

export type EndOutcome = Extract<EpisodeOutcome, 'boarded' | 'abandoned' | 'passed_full' | 'cancelled'>;

export interface OutcomeCopy {
  label: string;
  confirm: string;
  question: string;
  tone: 'primary' | 'secondary' | 'tertiary' | 'danger';
}

const OUTCOME_COPY = new Map<EpisodeOutcome, OutcomeCopy>([
  [
    'boarded',
    {
      label: 'Bus datang, saya naik',
      confirm: 'Ya, saya naik',
      question: 'Catat bahwa bus datang dan kamu naik?',
      tone: 'primary',
    },
  ],
  [
    'abandoned',
    {
      label: 'Saya menyerah',
      confirm: 'Ya, saya berhenti menunggu',
      question: 'Catat bahwa kamu berhenti menunggu?',
      tone: 'secondary',
    },
  ],
  [
    'passed_full',
    {
      label: 'Bus penuh',
      confirm: 'Ya, bus penuh',
      question: 'Catat bahwa bus datang tetapi penuh?',
      tone: 'tertiary',
    },
  ],
  [
    'cancelled',
    {
      label: 'Batalkan episode',
      confirm: 'Ya, batalkan',
      question: 'Batalkan episode ini? Catatan yang dibatalkan tidak dipakai sebagai bukti.',
      tone: 'danger',
    },
  ],
  [
    'timeout',
    {
      label: 'Ditutup otomatis',
      confirm: 'Ditutup otomatis',
      question: 'Penutupan otomatis tidak bisa diubah.',
      tone: 'tertiary',
    },
  ],
]);

const MODE_LABELS = new Map<StartMode, string>([
  ['qr', 'Mode QR'],
  ['gps_nearby', 'Mode GPS'],
  ['manual', 'Pilih manual'],
  ['resume', 'Dilanjutkan'],
  ['import', 'Impor'],
]);

export const END_OUTCOMES: readonly EndOutcome[] = ['boarded', 'abandoned', 'passed_full'];

export function outcomeCopy(outcome: EpisodeOutcome): OutcomeCopy {
  const copy = OUTCOME_COPY.get(outcome);
  if (copy === undefined) {
    throw new Error(`Hasil episode tidak dikenal: ${outcome}`);
  }
  return copy;
}

export function startModeLabel(mode: StartMode): string {
  return MODE_LABELS.get(mode) ?? 'Tidak diketahui';
}

export function presenceNote(presence: Presence): string | null {
  if (presence === 'unverified') {
    return 'Kehadiran belum terverifikasi, jadi catatan ini berbobot lebih rendah.';
  }
  if (presence === 'qr_only') {
    return 'Halte dipastikan lewat QR. Lokasi tidak dipakai.';
  }
  if (presence === 'qr_geo') {
    return 'Halte dipastikan lewat QR dan posisi kamu dekat.';
  }
  if (presence === 'gps_verified') {
    return 'Posisi terverifikasi lewat GPS tanpa QR.';
  }
  return 'Diperiksa pengamat terlatih di lokasi.';
}

export function elapsedSeedMs(startedAt: string, serverNow: string | null): number | null {
  const start = Date.parse(startedAt);
  const now = serverNow === null ? Date.now() : Date.parse(serverNow);
  if (Number.isNaN(start) || Number.isNaN(now)) {
    return null;
  }
  return Math.max(0, now - start);
}

export function isClosedBySystem(outcome: EpisodeOutcome | null): boolean {
  return outcome === 'timeout';
}

export type TicketSource = 'server' | 'device';

export interface TicketView {
  code: string;
  name: string;
  routeCode: string | null;
  modeLabel: string;
  startedAt: string;
  presenceNote: string | null;
  source: TicketSource;
}

export function ticketFromEpisode(episode: Episode, routeCode: string | null): TicketView {
  return {
    code: episode.stopCode,
    name: episode.stopName,
    routeCode,
    modeLabel: startModeLabel(episode.startMode),
    startedAt: episode.startedAt,
    presenceNote: presenceNote(episode.presence),
    source: 'server',
  };
}