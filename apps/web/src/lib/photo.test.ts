import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  formatBytes,
  isAcceptedPhoto,
  JPEG_QUALITY,
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  photoIssue,
} from './photo';

describe('fitWithin', () => {
  it('tidak memperbesar gambar yang sudah kecil', () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it('mengecilkan sisi terpanjang ke batas', () => {
    expect(fitWithin({ width: 3200, height: 1600 })).toEqual({ width: 1600, height: 800 });
    expect(fitWithin({ width: 1200, height: 2400 })).toEqual({ width: 800, height: 1600 });
  });

  it('mempertahankan rasio dalam satu piksel', () => {
    const result = fitWithin({ width: 4000, height: 3000 });
    expect(result.width).toBe(MAX_PHOTO_EDGE);
    expect(Math.round((result.height / result.width) * 1000)).toBe(750);
  });

  it('menjaga ukuran minimal satu piksel untuk masukan rusak', () => {
    expect(fitWithin({ width: 0, height: 0 })).toEqual({ width: 1, height: 1 });
    expect(fitWithin({ width: 100, height: 100 }, 0)).toEqual({ width: 1, height: 1 });
  });
});

describe('photoIssue', () => {
  it('menerima tipe dan ukuran yang diizinkan server', () => {
    expect(photoIssue({ type: 'image/jpeg', size: 1024 })).toBeNull();
    expect(photoIssue({ type: 'image/png', size: 2048 })).toBeNull();
    expect(photoIssue({ type: 'image/webp', size: 4096 })).toBeNull();
  });

  it('menolak berkas kosong lebih dulu', () => {
    expect(photoIssue({ type: 'image/jpeg', size: 0 })).toBe('empty');
  });

  it('menolak tipe yang tidak diterima server', () => {
    expect(photoIssue({ type: 'image/gif', size: 1024 })).toBe('unsupported_type');
    expect(photoIssue({ type: 'application/pdf', size: 1024 })).toBe('unsupported_type');
    expect(photoIssue({ type: 'image/svg+xml', size: 1024 })).toBe('unsupported_type');
  });

  it('menolak berkas di atas batas server', () => {
    expect(photoIssue({ type: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 })).toBe('too_large');
    expect(photoIssue({ type: 'image/jpeg', size: MAX_PHOTO_BYTES })).toBeNull();
  });
});

describe('isAcceptedPhoto', () => {
  it('sepakat dengan photoIssue untuk kasus batas', () => {
    expect(isAcceptedPhoto({ type: 'image/jpeg', size: 1 })).toBe(true);
    expect(isAcceptedPhoto({ type: 'image/gif', size: 1 })).toBe(false);
  });
});

describe('formatBytes', () => {
  it('memakai satuan yang bisa dibaca', () => {
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(900)).toBe('1 KB');
    expect(formatBytes(300 * 1024)).toBe('300 KB');
    expect(formatBytes(2.4 * 1024 * 1024)).toBe('2.4 MB');
  });
});

describe('parameter kompresi', () => {
  it('menjaga batas ukuran dan mutu tetap wajar', () => {
    expect(MAX_PHOTO_EDGE).toBe(1600);
    expect(JPEG_QUALITY).toBeGreaterThan(0.6);
    expect(JPEG_QUALITY).toBeLessThan(0.9);
  });
});
