export type AppealGrounds = 'rejection' | 'resolution' | 'moderation' | 'service';

export type AppealStatus =
  | 'submitted'
  | 'inadmissible'
  | 'admitted'
  | 'upheld'
  | 'overturned';

export type AppealOutcome = 'upheld' | 'overturned' | 'partial' | null;

export interface AppealWindow {
  grounds: AppealGrounds;
  days: number;
  deadline: string;
  open: boolean;
  reason: string | null;
}

export interface AppealRequest {
  grounds: AppealGrounds;
  reportStatus: string;
  decidedAt: string | null;
  submittedAt: string;
  now: string;
  priorAppeals: number;
}

export interface AppealAdmissibility {
  admissible: boolean;
  refusal: string | null;
  message: string;
}

export interface AppealEffect {
  fromStatus: string;
  toStatus: string;
  description: string;
}

export const APPEAL_WINDOWS: Readonly<Record<AppealGrounds, number>> = Object.freeze({
  rejection: 14,
  resolution: 14,
  moderation: 7,
  service: 30,
});

const DAY_MS = 86_400_000;

const GROUNDS_LABEL: Readonly<Record<AppealGrounds, string>> = Object.freeze({
  rejection: 'Penolakan laporan',
  resolution: 'Hasil penyelesaian',
  moderation: 'Moderasi konten',
  service: 'Tidak ada tindak lanjut',
});

const DECIDED_STATUSES: readonly string[] = [
  'claimed_resolved',
  'rejected',
  'verified_resolved',
  'disputed',
  'closed',
];

export function appealGroundsLabel(grounds: AppealGrounds): string {
  return GROUNDS_LABEL[grounds];
}

export function appealWindow(
  grounds: AppealGrounds,
  decidedAt: string | null,
  now: string,
): AppealWindow {
  const days = APPEAL_WINDOWS[grounds];
  if (decidedAt === null) {
    return {
      grounds,
      days,
      deadline: now,
      open: false,
      reason: 'Belum ada keputusan yang dapat dibanding.',
    };
  }
  const base = Date.parse(decidedAt);
  const current = Date.parse(now);
  if (!Number.isFinite(base) || !Number.isFinite(current)) {
    return {
      grounds,
      days,
      deadline: now,
      open: false,
      reason: 'Waktu keputusan tidak valid.',
    };
  }
  const deadline = new Date(base + days * DAY_MS).toISOString();
  const open = current <= base + days * DAY_MS;
  return {
    grounds,
    days,
    deadline,
    open,
    reason: open ? null : `Batas banding ${days} hari sudah terlewat.`,
  };
}

export function appealAdmissibility(request: AppealRequest): AppealAdmissibility {
  if (!DECIDED_STATUSES.includes(request.reportStatus)) {
    return {
      admissible: false,
      refusal: 'not_decided',
      message: `Banding hanya dapat diajukan setelah keputusan. Status sekarang: ${request.reportStatus}.`,
    };
  }
  if (request.priorAppeals >= 2) {
    return {
      admissible: false,
      refusal: 'appeal_limit',
      message: 'Batas dua banding per laporan sudah tercapai.',
    };
  }
  if (request.priorAppeals >= 1 && request.grounds === 'rejection') {
    return {
      admissible: false,
      refusal: 'repeat_grounds',
      message: 'Alasan penolakan hanya dapat dibanding satu kali.',
    };
  }
  const window = appealWindow(request.grounds, request.decidedAt, request.now);
  if (!window.open) {
    return {
      admissible: false,
      refusal: 'window_closed',
      message: window.reason ?? 'Jendela banding sudah tertutup.',
    };
  }
  return { admissible: true, refusal: null, message: 'Banding dapat diterima untuk ditinjau.' };
}

export function appealOutcomeEffect(
  grounds: AppealGrounds,
  outcome: AppealOutcome,
  currentStatus: string,
): AppealEffect {
  if (outcome === null) {
    return {
      fromStatus: currentStatus,
      toStatus: currentStatus,
      description: 'Banding belum diputuskan; status tidak berubah.',
    };
  }
  if (outcome === 'upheld') {
    return {
      fromStatus: currentStatus,
      toStatus: currentStatus,
      description: 'Banding ditolak; keputusan awal dipertahankan dan alasannya dipublikasikan.',
    };
  }
  const target =
    grounds === 'rejection'
      ? 'submitted'
      : grounds === 'resolution'
        ? 'disputed'
        : grounds === 'moderation'
          ? 'submitted'
          : 'acknowledged';
  if (outcome === 'partial') {
    return {
      fromStatus: currentStatus,
      toStatus: target,
      description: 'Banding diterima sebagian; laporan kembali ke antrean dengan catatan.',
    };
  }
  return {
    fromStatus: currentStatus,
    toStatus: target,
    description:
      grounds === 'resolution'
        ? 'Banding dikabulkan; klaim selesai dibatalkan dan laporan dibuka kembali.'
        : 'Banding dikabulkan; keputusan awal dibatalkan dan laporan diproses ulang.',
  };
}

export function appealBurdenOfProof(grounds: AppealGrounds): string {
  switch (grounds) {
    case 'rejection':
      return 'Pemohon menunjukkan laporan memenuhi syarat yang disebut alasan penolakan.';
    case 'resolution':
      return 'Pemohon menunjukkan masalah masih terjadi setelah klaim selesai.';
    case 'moderation':
      return 'Pemohon menunjukkan konten tidak melanggar pedoman.';
    case 'service':
      return 'Pemohon menunjukkan tenggat tindak lanjut terlewat tanpa penjelasan.';
  }
}

export function appealCaveats(): readonly string[] {
  return [
    'Banding tidak menghapus riwayat; keputusan awal, alasan banding, dan hasilnya tetap tercatat.',
    'Banding diadili pihak yang tidak menerbitkan keputusan awal.',
    'Mengabulkan banding tidak otomatis berarti laporan benar; laporan hanya diproses ulang.',
    'Batas dua banding per laporan mencegah pengulangan tanpa bukti baru.',
  ];
}

export function describeAppeal(
  grounds: AppealGrounds,
  status: AppealStatus,
  outcome: AppealOutcome,
): string {
  const label = appealGroundsLabel(grounds);
  if (status === 'submitted') {
    return `Banding ${label} menunggu ditinjau.`;
  }
  if (status === 'inadmissible') {
    return `Banding ${label} tidak dapat diterima.`;
  }
  if (status === 'admitted') {
    return `Banding ${label} diterima dan sedang ditinjau.`;
  }
  if (outcome === 'overturned') {
    return `Banding ${label} dikabulkan; keputusan awal dibatalkan.`;
  }
  if (outcome === 'partial') {
    return `Banding ${label} dikabulkan sebagian.`;
  }
  return `Banding ${label} ditolak; keputusan awal dipertahankan.`;
}
