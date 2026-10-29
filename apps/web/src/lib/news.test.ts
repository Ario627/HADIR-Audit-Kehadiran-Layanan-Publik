import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEWS_REGION,
  NEWS_MAX_EXCERPT,
  ageLabel,
  isNewsRegion,
  leadItem,
  readNewsRegion,
  restItems,
  scopeLabel,
  toNewsFeed,
  toNewsItem,
  type NewsItem,
} from './news';

const NOW = 1_760_000_000_000;
const ITEM = {
  id: '19o0g8h',
  title: 'Bus Trans Banyumas tambah armada',
  excerpt: 'Penambahan armada dilakukan bertahap mulai pekan depan.',
  url: 'https://www.cnnindonesia.com/otomotif/abc',
  source: 'cnnindonesia.com',
  publishedAt: '2026-10-28T10:00:00.000Z',
  imagePath: '/v1/news/media/abc.def',
  hasVideo: false,
  scope: 'daerah',
};

function feedOf(items: unknown[]): Record<string, unknown> {
  return {
    region: { code: 'banyumas', label: 'Banyumas' },
    items,
    fetchedAt: '2026-10-28T12:00:00.000Z',
  };
}

describe('isNewsRegion', () => {
  it('menerima empat cakupan', () => {
    expect(isNewsRegion('banyumas')).toBe(true);
    expect(isNewsRegion('semarang')).toBe(true);
    expect(isNewsRegion('jateng')).toBe(true);
    expect(isNewsRegion('nasional')).toBe(true);
  });

  it('menolak nilai asing', () => {
    expect(isNewsRegion('jakarta')).toBe(false);
    expect(isNewsRegion('')).toBe(false);
    expect(isNewsRegion(null)).toBe(false);
    expect(isNewsRegion(7)).toBe(false);
  });

  it('tidak membaca prototipe objek', () => {
    expect(isNewsRegion('toString')).toBe(false);
    expect(isNewsRegion('__proto__')).toBe(false);
  });
});

describe('readNewsRegion', () => {
  it('jatuh ke cakupan bawaan untuk nilai asing', () => {
    expect(readNewsRegion('jakarta')).toBe(DEFAULT_NEWS_REGION);
    expect(readNewsRegion(undefined)).toBe(DEFAULT_NEWS_REGION);
  });

  it('mempertahankan nilai sah', () => {
    expect(readNewsRegion('semarang')).toBe('semarang');
  });
});

describe('toNewsItem', () => {
  it('menerima item sah', () => {
    expect(toNewsItem(ITEM)).not.toBeNull();
    expect(toNewsItem(ITEM)?.title).toBe(ITEM.title);
  });

  it('menolak url non-http', () => {
    expect(toNewsItem({ ...ITEM, url: 'javascript:alert(1)' })).toBeNull();
    expect(toNewsItem({ ...ITEM, url: 'data:text/html,<script>' })).toBeNull();
    expect(toNewsItem({ ...ITEM, url: 'ftp://example.com/a' })).toBeNull();
  });

  it('mengosongkan imagePath di luar proksi kita tanpa membuang berita', () => {
    expect(toNewsItem({ ...ITEM, imagePath: 'https://evil.example/x.jpg' })?.imagePath).toBeNull();
    expect(toNewsItem({ ...ITEM, imagePath: '//evil.example/x.jpg' })?.imagePath).toBeNull();
    expect(toNewsItem({ ...ITEM, imagePath: '/v1/users/1' })?.imagePath).toBeNull();
  });

  it('mengosongkan imagePath dengan karakter kontrol', () => {
    expect(toNewsItem({ ...ITEM, imagePath: '/v1/news/media/a\u0000b' })?.imagePath).toBeNull();
    expect(toNewsItem({ ...ITEM, imagePath: '/v1/news/media/a b' })?.imagePath).toBeNull();
  });

  it('menerima imagePath proksi yang sah', () => {
    expect(toNewsItem(ITEM)?.imagePath).toBe('/v1/news/media/abc.def');
  });

  it('mengosongkan imagePath bila null', () => {
    expect(toNewsItem({ ...ITEM, imagePath: null })?.imagePath).toBeNull();
  });

  it('menolak scope asing', () => {
    expect(toNewsItem({ ...ITEM, scope: 'global' })).toBeNull();
  });

  it('menolak publishedAt rusak', () => {
    expect(toNewsItem({ ...ITEM, publishedAt: 'kemarin' })).toBeNull();
    expect(toNewsItem({ ...ITEM, publishedAt: 7 })).toBeNull();
  });

  it('menerima publishedAt null', () => {
    expect(toNewsItem({ ...ITEM, publishedAt: null })?.publishedAt).toBeNull();
  });

  it('menolak judul kosong atau kebesaran', () => {
    expect(toNewsItem({ ...ITEM, title: '   ' })).toBeNull();
    expect(toNewsItem({ ...ITEM, title: 'a'.repeat(200) })).toBeNull();
  });

  it('menolak nilai bukan objek', () => {
    expect(toNewsItem(null)).toBeNull();
    expect(toNewsItem([])).toBeNull();
    expect(toNewsItem('judul')).toBeNull();
  });

  it('memaksa hasVideo hanya untuk true', () => {
    expect(toNewsItem({ ...ITEM, hasVideo: 'true' })?.hasVideo).toBe(false);
    expect(toNewsItem({ ...ITEM, hasVideo: true })?.hasVideo).toBe(true);
  });
});

describe('toNewsFeed', () => {
  it('menerima feed sah', () => {
    const feed = toNewsFeed(feedOf([ITEM]));
    expect(feed?.region.code).toBe('banyumas');
    expect(feed?.items).toHaveLength(1);
  });

  it('membuang item rusak tanpa menggagalkan feed', () => {
    const feed = toNewsFeed(feedOf([ITEM, { id: 'x' }, null]));
    expect(feed?.items).toHaveLength(1);
  });

  it('menolak region asing', () => {
    expect(toNewsFeed({ ...feedOf([ITEM]), region: { code: 'jakarta', label: 'X' } })).toBeNull();
  });

  it('menolak fetchedAt rusak', () => {
    expect(toNewsFeed({ ...feedOf([ITEM]), fetchedAt: 'baru' })).toBeNull();
  });

  it('menolak items bukan larik', () => {
    expect(toNewsFeed({ ...feedOf([ITEM]), items: 'banyak' })).toBeNull();
  });

  it('mengisi label region dari peta bila kosong', () => {
    const feed = toNewsFeed({ ...feedOf([ITEM]), region: { code: 'semarang', label: '  ' } });
    expect(feed?.region.label).toBe('Semarang');
  });
});

describe('ageLabel', () => {
  it('menyebut menit, jam, dan hari', () => {
    expect(ageLabel(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 menit lalu');
    expect(ageLabel(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 jam lalu');
    expect(ageLabel(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe('kemarin');
    expect(ageLabel(new Date(NOW - 3 * 86_400_000).toISOString(), NOW)).toBe('3 hari lalu');
  });

  it('menangani waktu tanpa catatan', () => {
    expect(ageLabel(null, NOW)).toBe('waktu tidak tercatat');
    expect(ageLabel('bukan tanggal', NOW)).toBe('waktu tidak tercatat');
  });

  it('tidak menghasilkan angka negatif untuk waktu masa depan', () => {
    expect(ageLabel(new Date(NOW + 60_000).toISOString(), NOW)).toBe('baru saja');
  });
});

describe('pemilihan lead', () => {
  function item(id: string, imagePath: string | null): NewsItem {
    return { ...(ITEM as NewsItem), id, imagePath };
  }

  it('mendahulukan item bergambar', () => {
    const items = [item('a', null), item('b', '/v1/news/media/x')];
    expect(leadItem(items)?.id).toBe('b');
  });

  it('jatuh ke item pertama bila tak ada gambar', () => {
    const items = [item('a', null), item('b', null)];
    expect(leadItem(items)?.id).toBe('a');
  });

  it('mengembalikan null untuk daftar kosong', () => {
    expect(leadItem([])).toBeNull();
    expect(restItems([], null)).toEqual([]);
  });

  it('membuang lead dari sisa', () => {
    const items = [item('a', '/v1/news/media/x'), item('b', null)];
    const lead = leadItem(items);
    expect(restItems(items, lead).map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('scopeLabel', () => {
  it('memakai nama cakupan untuk berita daerah', () => {
    expect(scopeLabel('daerah', 'Banyumas')).toBe('Banyumas');
  });

  it('memakai kata Nasional untuk sisanya', () => {
    expect(scopeLabel('nasional', 'Banyumas')).toBe('Nasional');
  });
});

describe('batas cuplikan', () => {
  it('memangkas cuplikan yang kebesaran, bukan membuang berita', () => {
    const parsed = toNewsItem({ ...ITEM, excerpt: 'kata '.repeat(NEWS_MAX_EXCERPT) });
    expect(parsed).not.toBeNull();
    expect((parsed?.excerpt ?? '').length).toBeLessThanOrEqual(NEWS_MAX_EXCERPT + 1);
    expect(parsed?.excerpt.endsWith('…')).toBe(true);
  });
});
