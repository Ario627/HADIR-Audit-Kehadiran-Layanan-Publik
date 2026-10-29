import { describe, expect, it } from 'vitest';
import type { ChangelogSource } from './transparency';
import {
  TRANSPARENCY_SECTIONS,
  changelogOf,
  contactSection,
  correctionPolicy,
  correctionSection,
  downloadSection,
  versionAgeText,
} from './transparency';

describe('changelogOf', () => {
  const base: ChangelogSource = {
    methodVersion: '1.2.0',
    updatedAt: '2026-10-26T00:00:00.000Z',
    steps: [{ order: 1, title: 'a', detail: 'a' }],
    limitations: ['a'],
  };

  it('returns the current version as a single entry', () => {
    const entries = changelogOf(base);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.version).toBe('1.2.0');
    expect(entries[0]?.updatedAt).toBe('2026-10-26T00:00:00.000Z');
  });

  it('summarises the step and limit counts', () => {
    expect(changelogOf(base)[0]?.summary).toContain('1 langkah');
    expect(changelogOf(base)[0]?.summary).toContain('1 batasan');
  });

  it('returns nothing when the timestamp is unusable', () => {
    expect(changelogOf({ ...base, updatedAt: 'kemarin' })).toEqual([]);
  });
});

describe('versionAgeText', () => {
  const NOW = Date.parse('2026-10-28T09:00:00.000Z');

  it('describes a fresh version', () => {
    expect(versionAgeText('2026-10-28T01:00:00.000Z', NOW)).toBe('diperbarui hari ini');
    expect(versionAgeText('2026-10-27T01:00:00.000Z', NOW)).toBe('diperbarui kemarin');
    expect(versionAgeText('2026-10-21T01:00:00.000Z', NOW)).toBe('diperbarui 7 hari lalu');
  });

  it('refuses to invent an age', () => {
    expect(versionAgeText('kemarin', NOW)).toBe('tanggal versi tidak terbaca');
    expect(versionAgeText('2026-11-30T00:00:00.000Z', NOW)).toBe('tanggal versi tidak terbaca');
  });
});

describe('correctionPolicy', () => {
  it('names the mechanism without inventing a threshold', () => {
    const text = correctionPolicy();
    expect(text).toContain('late_correction');
    expect(text).toContain('cancelled');
    expect(text).toContain('jendela koreksi');
  });

  it('contains no bare number that could drift from the server', () => {
    expect(correctionPolicy()).not.toMatch(/\b(180|45|10)\b/u);
  });
});

describe('transparency sections', () => {
  it('marks every unimplemented section honestly', () => {
    for (const section of TRANSPARENCY_SECTIONS) {
      expect(section.available).toBe(false);
      expect(section.body.length).toBeGreaterThan(40);
    }
  });

  it('never pretends a corrections log exists', () => {
    expect(correctionSection().body).toContain('belum tersedia');
  });

  it('points readers at per-page public data instead of a bulk download', () => {
    expect(downloadSection().body).toContain('papan bukti');
    expect(downloadSection().body).toContain('mitra');
  });

  it('explains the missing contact instead of leaving a hole', () => {
    expect(contactSection().body).toContain('belum ditetapkan');
  });

  it('exposes exactly the three outstanding sections', () => {
    expect(TRANSPARENCY_SECTIONS.map((section) => section.id)).toEqual([
      'koreksi',
      'unduhan',
      'kontak',
    ]);
  });
});
