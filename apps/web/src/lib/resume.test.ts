import { describe, expect, it } from 'vitest';
import {
  CROSS_TAB_CHANNEL,
  RESUME_MARK_KEY,
  affectsEpisode,
  broadcastEpisodeChange,
  clearResumeMark,
  decodeCrossTab,
  encodeCrossTab,
  readResumeMark,
  shouldResume,
  waitPath,
  writeResumeMark,
  type CrossTabMessage,
} from './resume';

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function fakeStorage(): FakeStorage & { readonly map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function brokenStorage(): FakeStorage {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
}

const EPISODE = '0199a0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5b';

describe('waitPath', () => {
  it('menaruh id episode di bawah /wait/', () => {
    expect(waitPath(EPISODE)).toBe(`/wait/${EPISODE}`);
  });
});

describe('shouldResume', () => {
  it('melanjutkan saat ada episode aktif dan belum ditandai', () => {
    expect(
      shouldResume({ activeEpisodeId: EPISODE, alreadyResumed: false, currentPath: '/' }),
    ).toBe('resume');
  });

  it('diam saat tidak ada episode aktif', () => {
    expect(
      shouldResume({ activeEpisodeId: null, alreadyResumed: false, currentPath: '/' }),
    ).toBe('stay');
  });

  it('diam saat episode aktif sudah pernah dilanjutkan', () => {
    expect(
      shouldResume({ activeEpisodeId: EPISODE, alreadyResumed: true, currentPath: '/' }),
    ).toBe('stay');
  });

  it('diam saat sudah berada di halaman tiket itu sendiri', () => {
    expect(
      shouldResume({
        activeEpisodeId: EPISODE,
        alreadyResumed: false,
        currentPath: `/wait/${EPISODE}`,
      }),
    ).toBe('stay');
  });

  it('diam saat berada di halaman tiket lain', () => {
    expect(
      shouldResume({
        activeEpisodeId: EPISODE,
        alreadyResumed: false,
        currentPath: '/wait/0199a0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5c',
      }),
    ).toBe('stay');
  });

  it('diam saat berada di alur lapor', () => {
    expect(
      shouldResume({ activeEpisodeId: EPISODE, alreadyResumed: false, currentPath: '/lapor' }),
    ).toBe('resume');
  });

  it('mengabaikan id episode kosong', () => {
    expect(shouldResume({ activeEpisodeId: '', alreadyResumed: false, currentPath: '/' })).toBe(
      'stay',
    );
  });
});

describe('tanda sesi', () => {
  it('menulis dan membaca tanda untuk episode yang sama', () => {
    const store = fakeStorage();
    writeResumeMark(store, EPISODE);
    expect(readResumeMark(store, EPISODE)).toBe(true);
    expect(store.map.get(RESUME_MARK_KEY)).toBe(EPISODE);
  });

  it('menganggap episode berbeda belum ditandai', () => {
    const store = fakeStorage();
    writeResumeMark(store, EPISODE);
    expect(readResumeMark(store, '0199a0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5c')).toBe(false);
  });

  it('mengembalikan false untuk storage kosong', () => {
    expect(readResumeMark(fakeStorage(), EPISODE)).toBe(false);
  });

  it('mengembalikan false untuk storage null', () => {
    expect(readResumeMark(null, EPISODE)).toBe(false);
  });

  it('tidak melempar saat storage diblokir', () => {
    const store = brokenStorage();
    expect(() => writeResumeMark(store, EPISODE)).not.toThrow();
    expect(readResumeMark(store, EPISODE)).toBe(false);
    expect(() => clearResumeMark(store)).not.toThrow();
  });

  it('menghapus tanda', () => {
    const store = fakeStorage();
    writeResumeMark(store, EPISODE);
    clearResumeMark(store);
    expect(readResumeMark(store, EPISODE)).toBe(false);
    expect(store.map.size).toBe(0);
  });
});

describe('encodeCrossTab dan decodeCrossTab', () => {
  it('bolak balik pesan episode', () => {
    const message: CrossTabMessage = { kind: 'episode-changed', episodeId: EPISODE };
    expect(decodeCrossTab(encodeCrossTab(message))).toEqual(message);
  });

  it('bolak balik pesan tanpa episode', () => {
    const message: CrossTabMessage = { kind: 'episode-changed', episodeId: null };
    expect(decodeCrossTab(encodeCrossTab(message))).toEqual(message);
  });

  it('menolak teks mentah', () => {
    expect(decodeCrossTab('episode-changed')).toBeNull();
  });

  it('menolak JSON rusak', () => {
    expect(decodeCrossTab('{')).toBeNull();
  });

  it('menolak objek dengan kind asing', () => {
    expect(decodeCrossTab(JSON.stringify({ kind: 'lain', episodeId: EPISODE }))).toBeNull();
  });

  it('menolak objek tanpa kind', () => {
    expect(decodeCrossTab(JSON.stringify({ episodeId: EPISODE }))).toBeNull();
  });

  it('menolak pesan kebesaran', () => {
    const big = JSON.stringify({ kind: 'episode-changed', episodeId: 'x'.repeat(600) });
    expect(decodeCrossTab(big)).toBeNull();
  });

  it('menolak id yang bukan teks', () => {
    expect(decodeCrossTab(JSON.stringify({ kind: 'episode-changed', episodeId: 7 }))).toBeNull();
  });

  it('menolak id kebesaran', () => {
    expect(
      decodeCrossTab(JSON.stringify({ kind: 'episode-changed', episodeId: 'x'.repeat(80) })),
    ).toBeNull();
  });

  it('menolak nilai bukan objek', () => {
    expect(decodeCrossTab(null)).toBeNull();
    expect(decodeCrossTab(undefined)).toBeNull();
    expect(decodeCrossTab(42)).toBeNull();
    expect(decodeCrossTab(['episode-changed'])).toBeNull();
  });

  it('menerima payload yang sudah berupa objek', () => {
    expect(decodeCrossTab({ kind: 'episode-changed', episodeId: EPISODE })).toEqual({
      kind: 'episode-changed',
      episodeId: EPISODE,
    });
  });
});

describe('affectsEpisode', () => {
  it('cocok saat episode sama', () => {
    expect(affectsEpisode({ kind: 'episode-changed', episodeId: EPISODE }, EPISODE)).toBe(true);
  });

  it('cocok saat episode hilang', () => {
    expect(affectsEpisode({ kind: 'episode-changed', episodeId: null }, EPISODE)).toBe(true);
  });

  it('tidak cocok untuk episode lain', () => {
    expect(
      affectsEpisode(
        { kind: 'episode-changed', episodeId: '0199a0b1-2c3d-4e5f-8a9b-0c1d2e3f4a5c' },
        EPISODE,
      ),
    ).toBe(false);
  });
});

describe('broadcastEpisodeChange', () => {
  it('tidak melempar di lingkungan tanpa BroadcastChannel', () => {
    expect(() => broadcastEpisodeChange(EPISODE)).not.toThrow();
  });

  it('memakai nama kanal tetap', () => {
    expect(CROSS_TAB_CHANNEL).toBe('hadir:episode');
  });
});
