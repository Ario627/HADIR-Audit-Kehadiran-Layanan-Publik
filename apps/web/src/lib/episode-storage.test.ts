import { describe, expect, it } from 'vitest';
import { decodeStoredEpisode, encodeStoredEpisode, ticketFromStorage } from './episode-storage';

const NOW = Date.parse('2026-10-26T04:00:00.000Z');

const RECORD = {
  episodeId: '018bcfe5-0000-7000-8000-000000000001',
  stopCode: 'BMS-A12',
  stopName: 'Halte UMP',
  routeCode: 'K3A',
  startedAt: '2026-10-26T03:42:00.000Z',
  startMode: 'qr',
  presence: 'qr_only',
} as const;

function raw(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...RECORD, savedAt: NOW - 60_000, ...overrides });
}

describe('decodeStoredEpisode', () => {
  it('membaca rekaman yang ditulis encoder sendiri', () => {
    const encoded = encodeStoredEpisode(RECORD, NOW - 1_000);
    expect(decodeStoredEpisode(encoded, NOW)).toEqual({ ...RECORD, savedAt: NOW - 1_000 });
  });

  it('mengembalikan null untuk isi yang bukan JSON atau kosong', () => {
    expect(decodeStoredEpisode(null, NOW)).toBeNull();
    expect(decodeStoredEpisode('{', NOW)).toBeNull();
    expect(decodeStoredEpisode('[]', NOW)).toBeNull();
    expect(decodeStoredEpisode('null', NOW)).toBeNull();
  });

  it('menolak rekaman yang lebih tua dari 24 jam', () => {
    const old = raw({ savedAt: NOW - 25 * 60 * 60 * 1000 });
    expect(decodeStoredEpisode(old, NOW)).toBeNull();
  });

  it('menolak rekaman bertanda waktu masa depan', () => {
    const future = raw({ savedAt: NOW + 5 * 60_000 });
    expect(decodeStoredEpisode(future, NOW)).toBeNull();
  });

  it('menolak enum dan tanggal yang tidak dikenal', () => {
    expect(decodeStoredEpisode(raw({ startMode: 'teleport' }), NOW)).toBeNull();
    expect(decodeStoredEpisode(raw({ presence: 'keren' }), NOW)).toBeNull();
    expect(decodeStoredEpisode(raw({ startedAt: 'kemarin' }), NOW)).toBeNull();
    expect(decodeStoredEpisode(raw({ episodeId: '' }), NOW)).toBeNull();
  });

  it('menerima routeCode null tetapi menolak bentuk yang salah', () => {
    expect(decodeStoredEpisode(raw({ routeCode: null }), NOW)?.routeCode).toBeNull();
    expect(decodeStoredEpisode(raw({ routeCode: 7 }), NOW)).toBeNull();
    expect(decodeStoredEpisode(raw({ routeCode: 'K'.repeat(13) }), NOW)).toBeNull();
  });

  it('mengabaikan properti tambahan yang tidak dikenal', () => {
    const decoded = decodeStoredEpisode(raw({ location: { lat: -7.4 } }), NOW);
    expect(decoded).not.toBeNull();
    expect(Object.hasOwn(decoded ?? {}, 'location')).toBe(false);
  });
});

describe('ticketFromStorage', () => {
  it('menandai data sebagai berasal dari perangkat dan tidak mengarang status kehadiran', () => {
    const decoded = decodeStoredEpisode(raw(), NOW);
    expect(decoded).not.toBeNull();
    if (decoded === null) {
      return;
    }
    const view = ticketFromStorage(decoded);
    expect(view.source).toBe('device');
    expect(view.presenceNote).toBeNull();
    expect(view.routeCode).toBe('K3A');
    expect(view.modeLabel).toBe('Mode QR');
  });
});
