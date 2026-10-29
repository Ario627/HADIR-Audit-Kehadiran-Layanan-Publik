import { afterEach, describe, expect, it } from 'vitest';
import {
  clearLocalData,
  clearSummary,
  inventorySummary,
  NOT_COLLECTED,
  PRIVACY_PRINCIPLES,
  readLocalInventory,
} from './privacy';

class MemoryStorage {
  private readonly entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }
}

function installWindow(): MemoryStorage {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true,
    writable: true,
  });
  return storage;
}

function removeWindow(): void {
  Reflect.deleteProperty(globalThis, 'window');
}

afterEach(() => {
  removeWindow();
});

describe('readLocalInventory', () => {
  it('mengembalikan inventaris kosong saat penyimpanan tidak tersedia', () => {
    removeWindow();
    expect(readLocalInventory()).toEqual({ episode: null, reportIds: [] });
  });

  it('membaca episode dan nomor laporan yang tersimpan', () => {
    const storage = installWindow();
    storage.setItem(
      'hadir.episode.v1',
      JSON.stringify({
        episodeId: '018bcfe5-0000-7000-8000-000000000001',
        stopCode: 'BMS-A12',
        stopName: 'Halte UMP',
        routeCode: 'K3A',
        startedAt: '2026-10-28T01:00:00.000Z',
        startMode: 'qr',
        presence: 'qr_only',
        savedAt: Date.parse('2026-10-28T01:00:00.000Z'),
      }),
    );
    storage.setItem('hadir.reports.v1', JSON.stringify(['123456', '654321']));

    const inventory = readLocalInventory(Date.parse('2026-10-28T02:00:00.000Z'));
    expect(inventory.episode?.stopName).toBe('Halte UMP');
    expect(inventory.reportIds).toEqual(['123456', '654321']);
  });

  it('membuang rekaman rusak tanpa melempar', () => {
    const storage = installWindow();
    storage.setItem('hadir.episode.v1', '{rusak');
    storage.setItem('hadir.reports.v1', 'bukan larik');
    expect(readLocalInventory()).toEqual({ episode: null, reportIds: [] });
  });
});

describe('clearLocalData', () => {
  it('menghapus kedua kunci dan melaporkan apa yang dihapus', async () => {
    const storage = installWindow();
    const openedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    storage.setItem('hadir.reports.v1', JSON.stringify(['123456']));
    storage.setItem(
      'hadir.episode.v1',
      JSON.stringify({
        episodeId: '018bcfe5-0000-7000-8000-000000000001',
        stopCode: 'BMS-A12',
        stopName: 'Halte UMP',
        routeCode: null,
        startedAt: openedAt,
        startMode: 'manual',
        presence: 'unverified',
        savedAt: Date.parse(openedAt),
      }),
    );

    const result = await clearLocalData();
    expect(result.episodeRemoved).toBe(true);
    expect(result.reportsRemoved).toBe(1);
    expect(storage.getItem('hadir.episode.v1')).toBeNull();
    expect(storage.getItem('hadir.reports.v1')).toBeNull();
  });

  it('aman dipanggil saat perangkat belum punya data', async () => {
    installWindow();
    const result = await clearLocalData();
    expect(result.episodeRemoved).toBe(false);
    expect(result.reportsRemoved).toBe(0);
    expect(result.draftRemoved).toBe(false);
    expect(result.queuedRemoved).toBe(0);
  });

  it('aman dipanggil tanpa penyimpanan sama sekali', async () => {
    removeWindow();
    await expect(clearLocalData()).resolves.toBeDefined();
  });
});

describe('clearSummary', () => {
  it('menyebut semua yang terhapus', () => {
    const summary = clearSummary({
      episodeRemoved: true,
      reportsRemoved: 2,
      draftRemoved: true,
      queuedRemoved: 1,
    });
    expect(summary).toContain('episode tunggu');
    expect(summary).toContain('2 nomor laporan');
    expect(summary).toContain('draf laporan');
    expect(summary).toContain('1 catatan antrean');
  });

  it('mengatakan tidak ada yang perlu dihapus', () => {
    expect(
      clearSummary({
        episodeRemoved: false,
        reportsRemoved: 0,
        draftRemoved: false,
        queuedRemoved: 0,
      }),
    ).toBe('Tidak ada catatan lokal yang perlu dihapus.');
  });
});

describe('inventorySummary', () => {
  it('menyebut episode aktif bila ada', () => {
    const summary = inventorySummary({
      episode: {
        episodeId: '018bcfe5-0000-7000-8000-000000000001',
        stopCode: 'BMS-A12',
        stopName: 'Halte UMP',
        routeCode: null,
        startedAt: '2026-10-28T01:00:00.000Z',
        startMode: 'manual',
        presence: 'unverified',
        savedAt: 0,
      },
      reportIds: ['123456'],
    });
    expect(summary).toContain('Halte UMP');
    expect(summary).toContain('1 nomor laporan');
  });

  it('mengatakan tidak ada data saat kosong', () => {
    expect(inventorySummary({ episode: null, reportIds: [] })).toContain('Tidak ada episode');
  });
});

describe('materi notice', () => {
  it('menyatakan secara eksplisit apa yang tidak dikumpulkan', () => {
    expect(NOT_COLLECTED.join(' ')).toContain('Titik koordinat presisi');
    expect(NOT_COLLECTED).toHaveLength(4);
  });

  it('menjaga empat prinsip yang bisa diperiksa di UI', () => {
    expect(PRIVACY_PRINCIPLES).toHaveLength(4);
    for (const principle of PRIVACY_PRINCIPLES) {
      expect(principle.detail.length).toBeGreaterThan(20);
    }
  });
});
