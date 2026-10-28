import { describe, expect, it } from 'vitest';
import {
  MAX_RANGE_DAYS,
  PRESETS,
  dayEndIso,
  dayFromOffset,
  dayStartIso,
  presetDays,
  presetRange,
  rangeDays,
  rangeIssueText,
  rangeIssues,
  readDay,
  readPreset,
  readRange,
  toIsoRange,
  toRangeSearch,
  todayDay,
  type RangeIssue,
} from './date-range';

const NOW = new Date(2026, 9, 28, 15, 30).getTime();

describe('readDay', () => {
  it('accepts a real calendar day', () => {
    expect(readDay('2026-10-28')).toBe('2026-10-28');
    expect(readDay(' 2026-10-28 ')).toBe('2026-10-28');
  });

  it('rejects impossible days', () => {
    expect(readDay('2026-02-31')).toBeNull();
    expect(readDay('2026-13-01')).toBeNull();
    expect(readDay('2025-02-29')).toBeNull();
  });

  it('accepts a leap day', () => {
    expect(readDay('2028-02-29')).toBe('2028-02-29');
  });

  it('rejects other shapes', () => {
    expect(readDay('28-10-2026')).toBeNull();
    expect(readDay('2026-10-8')).toBeNull();
    expect(readDay('')).toBeNull();
    expect(readDay(null)).toBeNull();
    expect(readDay(20261028)).toBeNull();
  });
});

describe('todayDay', () => {
  it('uses the local calendar day', () => {
    expect(todayDay(NOW)).toBe('2026-10-28');
  });

  it('pads month and day', () => {
    expect(todayDay(new Date(2026, 0, 5, 9, 0).getTime())).toBe('2026-01-05');
  });
});

describe('dayFromOffset', () => {
  it('walks backwards across a month boundary', () => {
    expect(dayFromOffset('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('walks backwards across a year boundary', () => {
    expect(dayFromOffset('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('returns the input unchanged for junk', () => {
    expect(dayFromOffset('kemarin', -1)).toBe('kemarin');
    expect(dayFromOffset('2026-10-28', Number.NaN)).toBe('2026-10-28');
  });
});

describe('presetRange', () => {
  it('returns an inclusive seven day window', () => {
    const range = presetRange('7d', NOW);
    expect(range.to).toBe('2026-10-28');
    expect(range.from).toBe('2026-10-22');
    expect(rangeDays(range)).toBe(7);
  });

  it('returns thirty and ninety day windows', () => {
    expect(rangeDays(presetRange('30d', NOW))).toBe(30);
    expect(rangeDays(presetRange('90d', NOW))).toBe(90);
  });

  it('maps presets to day counts', () => {
    expect(presetDays('7d')).toBe(7);
    expect(presetDays('30d')).toBe(30);
    expect(presetDays('90d')).toBe(90);
  });
});

describe('readPreset', () => {
  it('accepts the four presets and nothing else', () => {
    expect(readPreset('7d')).toBe('7d');
    expect(readPreset('custom')).toBe('custom');
    expect(readPreset('365d')).toBeNull();
    expect(readPreset(null)).toBeNull();
    expect(PRESETS).toHaveLength(4);
  });
});

describe('readRange', () => {
  it('prefers explicit dates over a preset', () => {
    const read = readRange({ dari: '2026-01-01', sampai: '2026-01-31', rentang: '7d' }, NOW);
    expect(read.preset).toBe('custom');
    expect(read.range).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });

  it('falls back to the default window', () => {
    const read = readRange({}, NOW);
    expect(read.preset).toBe('30d');
    expect(rangeDays(read.range)).toBe(30);
  });

  it('ignores one-sided dates and uses the preset', () => {
    const read = readRange({ dari: '2026-01-01', rentang: '7d' }, NOW);
    expect(read.preset).toBe('7d');
    expect(read.range.to).toBe('2026-10-28');
  });

  it('ignores an unknown preset', () => {
    expect(readRange({ rentang: '365d' }, NOW).preset).toBe('30d');
  });

  it('rejects a custom preset without dates', () => {
    expect(readRange({ rentang: 'custom' }, NOW).preset).toBe('30d');
  });
});

describe('toRangeSearch', () => {
  it('omits the default window from the address', () => {
    expect(toRangeSearch({ preset: '30d', range: presetRange('30d', NOW) })).toEqual({});
  });

  it('keeps a non-default preset', () => {
    expect(toRangeSearch({ preset: '7d', range: presetRange('7d', NOW) })).toEqual({ rentang: '7d' });
  });

  it('serialises a custom range', () => {
    expect(
      toRangeSearch({ preset: 'custom', range: { from: '2026-01-01', to: '2026-01-31' } }),
    ).toEqual({ rentang: 'custom', dari: '2026-01-01', sampai: '2026-01-31' });
  });

  it('drops a broken custom range', () => {
    expect(toRangeSearch({ preset: 'custom', range: { from: 'x', to: 'y' } })).toEqual({});
  });
});

describe('dayStartIso and dayEndIso', () => {
  it('brackets the whole local day', () => {
    const start = dayStartIso('2026-10-28');
    const end = dayEndIso('2026-10-28');
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(new Date(start as string).getHours()).toBe(0);
    expect(new Date(end as string).getHours()).toBe(23);
    expect(Date.parse(end as string) - Date.parse(start as string)).toBe(86_399_999);
  });

  it('emits a Z suffix so the string comparison stays honest', () => {
    expect(dayStartIso('2026-10-28')?.endsWith('Z')).toBe(true);
  });

  it('returns null for junk', () => {
    expect(dayStartIso('2026-02-31')).toBeNull();
    expect(dayEndIso('kemarin')).toBeNull();
  });
});

describe('toIsoRange', () => {
  it('converts a filled range', () => {
    const iso = toIsoRange({ from: '2026-10-01', to: '2026-10-31' });
    expect(iso.from).toBe(dayStartIso('2026-10-01'));
    expect(iso.to).toBe(dayEndIso('2026-10-31'));
  });

  it('omits the bounds that are not set', () => {
    expect(toIsoRange({ from: '', to: '' })).toEqual({});
  });

  it('keeps a single valid bound', () => {
    const iso = toIsoRange({ from: '2026-10-01', to: '' });
    expect(iso.from).toBe(dayStartIso('2026-10-01'));
    expect(iso.to).toBeUndefined();
  });

  it('produces strings that sort correctly', () => {
    const iso = toIsoRange({ from: '2026-10-01', to: '2026-10-31' });
    expect((iso.from as string) <= (iso.to as string)).toBe(true);
  });
});

describe('rangeDays', () => {
  it('counts inclusively', () => {
    expect(rangeDays({ from: '2026-10-28', to: '2026-10-28' })).toBe(1);
    expect(rangeDays({ from: '2026-10-27', to: '2026-10-28' })).toBe(2);
  });

  it('returns null for a reversed or broken range', () => {
    expect(rangeDays({ from: '2026-10-28', to: '2026-10-01' })).toBeNull();
    expect(rangeDays({ from: 'x', to: 'y' })).toBeNull();
  });
});

describe('rangeIssues', () => {
  it('flags an incomplete range', () => {
    expect(rangeIssues({ from: '', to: '' }, NOW, MAX_RANGE_DAYS)).toBe('incomplete');
    expect(rangeIssues({ from: '2026-10-01', to: '' }, NOW, MAX_RANGE_DAYS)).toBe('incomplete');
  });

  it('flags a reversed range', () => {
    expect(rangeIssues({ from: '2026-10-28', to: '2026-10-01' }, NOW, MAX_RANGE_DAYS)).toBe(
      'reversed',
    );
  });

  it('flags a range longer than the cap', () => {
    expect(rangeIssues({ from: '2026-01-01', to: '2026-10-28' }, NOW, MAX_RANGE_DAYS)).toBe(
      'too_long',
    );
  });

  it('accepts a range exactly at the cap', () => {
    expect(rangeIssues({ from: '2026-05-02', to: '2026-10-28' }, NOW, MAX_RANGE_DAYS)).toBeNull();
  });

  it('flags a future end date', () => {
    expect(rangeIssues({ from: '2026-10-01', to: '2026-10-29' }, NOW, MAX_RANGE_DAYS)).toBe('future');
  });

  it('accepts a range that ends today', () => {
    expect(rangeIssues({ from: '2026-10-01', to: '2026-10-28' }, NOW, MAX_RANGE_DAYS)).toBeNull();
  });
});

describe('rangeIssueText', () => {
  it('has Indonesian copy for every issue', () => {
    const issues: readonly RangeIssue[] = ['incomplete', 'reversed', 'too_long', 'future'];
    for (const issue of issues) {
      expect(rangeIssueText(issue, MAX_RANGE_DAYS).length).toBeGreaterThan(15);
    }
  });

  it('names the cap in the too long message', () => {
    expect(rangeIssueText('too_long', 180)).toContain('180');
  });
});
