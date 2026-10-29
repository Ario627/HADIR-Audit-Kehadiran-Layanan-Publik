import { describe, expect, it } from 'vitest';
import { EVIDENCE_LEVELS, evidenceOf, isEvidenceLevel } from './evidence';

describe('evidence', () => {
  it('memberi label teks untuk setiap level, bukan hanya warna', () => {
    for (const level of EVIDENCE_LEVELS) {
      const descriptor = evidenceOf(level);
      expect(descriptor.level).toBe(level);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.detail.length).toBeGreaterThan(0);
    }
  });

  it('memakai label yang sama dengan dokumen desain', () => {
    expect(evidenceOf('none').label).toBe('Belum cukup data');
    expect(evidenceOf('strong').label).toBe('Bukti kuat');
  });

  it('menolak kunci objek sebagai level bukti', () => {
    expect(isEvidenceLevel('strong')).toBe(true);
    expect(isEvidenceLevel('toString')).toBe(false);
    expect(isEvidenceLevel('__proto__')).toBe(false);
    expect(isEvidenceLevel(1)).toBe(false);
  });
});
