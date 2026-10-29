export type StopStatus = 'active' | 'inactive' | 'moved' | 'planned';

export interface StopStatusNote {
  title: string;
  body: string;
  tone: 'info' | 'warn';
  blocksStart: boolean;
}

const NOTES: Record<StopStatus, StopStatusNote | null> = {
  active: null,
  moved: {
    title: 'Halte ini sudah dipindahkan',
    body: 'Titik henti yang dipakai sekarang ada di lokasi lain. Catatan tunggu di halte ini tidak lagi dipakai untuk estimasi.',
    tone: 'warn',
    blocksStart: true,
  },
  inactive: {
    title: 'Halte ini tidak aktif',
    body: 'Belum ada layanan yang berhenti di sini, jadi catatan tunggu tidak bisa dimulai dari titik ini.',
    tone: 'warn',
    blocksStart: true,
  },
  planned: {
    title: 'Halte ini masih direncanakan',
    body: 'Halte belum beroperasi. Catatan tunggu baru bisa dibuat setelah halte diaktifkan.',
    tone: 'info',
    blocksStart: true,
  },
};

const LABELS: Record<StopStatus, string> = {
  active: 'Aktif',
  inactive: 'Tidak aktif',
  moved: 'Dipindahkan',
  planned: 'Direncanakan',
};

export function stopStatusNote(status: StopStatus): StopStatusNote | null {
  return NOTES[status];
}

export function stopStatusLabel(status: StopStatus): string {
  return LABELS[status];
}

export function canStartAt(status: StopStatus): boolean {
  return NOTES[status] === null;
}