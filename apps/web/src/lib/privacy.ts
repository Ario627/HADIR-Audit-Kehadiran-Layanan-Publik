import { clearDraft } from './draft-store';
import type { StoredEpisode } from './episode-storage';
import { clearStoredEpisode, readStoredEpisode } from './episode-storage';
import { readOutbox, writeOutbox } from './outbox-store';
import { clearOwnReports, readOwnReports } from './report';

export interface LocalDataInventory {
  episode: StoredEpisode | null;
  reportIds: readonly string[];
}

export interface LocalClearResult {
  episodeRemoved: boolean;
  reportsRemoved: number;
  draftRemoved: boolean;
  queuedRemoved: number;
}

export const PRIVACY_PRINCIPLES: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: 'Tanpa akun',
    detail: 'Tidak ada nama, email, atau nomor telepon yang diminta untuk mencatat tunggu.',
  },
  {
    title: 'Tanpa koordinat',
    detail: 'Mode QR tidak memakai lokasi. Mode GPS hanya mengirim tingkat jarak, bukan titik presisi.',
  },
  {
    title: 'Pseudonim perangkat',
    detail: 'Perangkat dikenali lewat cookie bertanda tangan yang di-hash; isinya tidak bisa dibaca aplikasi.',
  },
  {
    title: 'Bisa dihapus',
    detail: 'Catatan di perangkat ini bisa dihapus kapan saja tanpa memengaruhi data publik yang sudah terkirim.',
  },
];

export const NOT_COLLECTED: readonly string[] = [
  'Nama dan identitas',
  'Email dan nomor telepon',
  'Titik koordinat presisi',
  'Kontak, riwayat lokasi, dan daftar aplikasi',
];

export function readLocalInventory(now: number = Date.now()): LocalDataInventory {
  return {
    episode: readStoredEpisode(now),
    reportIds: readOwnReports(),
  };
}

export function clearLocalDataSync(): { episodeRemoved: boolean; reportsRemoved: number } {
  const before = readLocalInventory();
  clearStoredEpisode();
  clearOwnReports();
  return {
    episodeRemoved: before.episode !== null,
    reportsRemoved: before.reportIds.length,
  };
}

export interface PendingLocal {
  queued: number;
}

export async function readPendingLocal(now: number = Date.now()): Promise<PendingLocal> {
  const entries = await readOutbox(now);
  return { queued: entries.length };
}

export async function clearLocalData(now: number = Date.now()): Promise<LocalClearResult> {
  const sync = clearLocalDataSync();
  const pending = await readPendingLocal(now);
  const draftRemoved = await clearDraft();
  await writeOutbox([]);
  return {
    episodeRemoved: sync.episodeRemoved,
    reportsRemoved: sync.reportsRemoved,
    draftRemoved,
    queuedRemoved: pending.queued,
  };
}

export function clearSummary(result: LocalClearResult): string {
  const parts: string[] = [];
  if (result.episodeRemoved) {
    parts.push('episode tunggu');
  }
  if (result.reportsRemoved > 0) {
    parts.push(`${result.reportsRemoved} nomor laporan`);
  }
  if (result.draftRemoved) {
    parts.push('draf laporan');
  }
  if (result.queuedRemoved > 0) {
    parts.push(`${result.queuedRemoved} catatan antrean`);
  }
  return parts.length === 0
    ? 'Tidak ada catatan lokal yang perlu dihapus.'
    : `Sudah dihapus dari perangkat ini: ${parts.join(', ')}.`;
}

export function inventorySummary(inventory: LocalDataInventory): string {
  const parts: string[] = [];
  parts.push(
    inventory.episode === null
      ? 'Tidak ada episode aktif di perangkat ini'
      : `Episode di ${inventory.episode.stopName} sejak ${inventory.episode.startedAt}`,
  );
  parts.push(
    inventory.reportIds.length === 0
      ? 'belum ada nomor laporan tersimpan'
      : `${inventory.reportIds.length} nomor laporan tersimpan`,
  );
  return `${parts[0]}; ${parts[1]}.`;
}