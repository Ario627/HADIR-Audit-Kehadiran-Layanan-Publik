import { describe, expect, it } from 'vitest';
import {
  anchorDateLabel,
  anchorDayCount,
  formatAnchorCount,
  groupMerkleRoot,
  nextDayUtc,
  previousDays,
  readAnchorDate,
  shortenRoot,
  utcDayString,
  yesterdayUtc,
} from './anchor';

describe('readAnchorDate', () => {
  it('accepts a real date', () => {
    expect(readAnchorDate('2026-10-31')).toBe('2026-10-31');
  });

  it('rejects malformed input', () => {
    expect(readAnchorDate('2026-10-3')).toBeNull();
    expect(readAnchorDate('31-10-2026')).toBeNull();
    expect(readAnchorDate('')).toBeNull();
    expect(readAnchorDate(null)).toBeNull();
    expect(readAnchorDate(20_261_031)).toBeNull();
  });

  it('rejects dates that do not exist', () => {
    expect(readAnchorDate('2026-02-31')).toBeNull();
    expect(readAnchorDate('2026-13-01')).toBeNull();
    expect(readAnchorDate('2025-02-29')).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(readAnchorDate('2028-02-29')).toBe('2028-02-29');
  });
});

describe('utcDayString', () => {
  it('slices the UTC day, not the local day', () => {
    expect(utcDayString(new Date('2026-10-31T23:59:59.000Z'))).toBe('2026-10-31');
    expect(utcDayString(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-31');
  });
});

describe('yesterdayUtc', () => {
  it('crosses the month boundary', () => {
    expect(yesterdayUtc(new Date('2026-03-01T00:30:00.000Z'))).toBe('2026-02-28');
  });

  it('crosses the year boundary', () => {
    expect(yesterdayUtc(new Date('2027-01-01T12:00:00.000Z'))).toBe('2026-12-31');
  });
});

describe('previousDays', () => {
  it('walks backwards without skipping days', () => {
    expect(previousDays('2026-03-01', 3)).toEqual(['2026-03-01', '2026-02-28', '2026-02-27']);
  });

  it('returns nothing for unusable input', () => {
    expect(previousDays('2026-02-31', 3)).toEqual([]);
    expect(previousDays('2026-03-01', 0)).toEqual([]);
  });
});

describe('nextDayUtc', () => {
  it('advances one day', () => {
    expect(nextDayUtc('2026-12-31')).toBe('2027-01-01');
  });

  it('returns null for an invalid date', () => {
    expect(nextDayUtc('kemarin')).toBeNull();
  });
});

describe('groupMerkleRoot', () => {
  it('splits a base64 root into readable chunks', () => {
    const root = 'A'.repeat(44);
    const chunks = groupMerkleRoot(root);
    expect(chunks).toHaveLength(4);
    expect(chunks.join('')).toBe(root);
    expect(chunks[0]).toHaveLength(11);
    expect(chunks[3]).toHaveLength(11);
  });

  it('returns an empty list for an empty root', () => {
    expect(groupMerkleRoot('   ')).toEqual([]);
  });
});

describe('shortenRoot', () => {
  it('keeps short roots untouched', () => {
    expect(shortenRoot('abc')).toBe('abc');
  });

  it('truncates long roots with an ellipsis', () => {
    const short = shortenRoot('A'.repeat(44));
    expect(short).toBe(`${'A'.repeat(10)}…${'A'.repeat(6)}`);
  });
});

describe('formatAnchorCount', () => {
  it('formats counts with Indonesian grouping', () => {
    expect(formatAnchorCount(1)).toBe('1 event');
    expect(formatAnchorCount(1200)).toBe('1.200 event');
  });

  it('falls back for unusable numbers', () => {
    expect(formatAnchorCount(-1)).toBe('jumlah event tidak diketahui');
    expect(formatAnchorCount(Number.NaN)).toBe('jumlah event tidak diketahui');
  });
});

describe('anchorDateLabel', () => {
  it('renders a readable Indonesian date', () => {
    const label = anchorDateLabel('2026-10-31');
    expect(label).toContain('2026');
    expect(label).toContain('31');
  });

  it('degrades honestly for invalid input', () => {
    expect(anchorDateLabel('2026-02-31')).toBe('tanggal tidak dikenal');
  });
});

describe('anchorDayCount', () => {
  it('uses the singular for one day', () => {
    expect(anchorDayCount(1)).toBe('1 hari');
    expect(anchorDayCount(7)).toBe('7 hari');
  });
});