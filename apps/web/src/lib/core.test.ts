import { describe, expect, it } from 'vitest';
import { uuidv7 } from './id';
import {
  elapsedSeconds,
  formatClockTime,
  formatDurationMinutes,
  formatNumber,
  formatTimer,
} from './time';

describe('uuidv7', () => {
  it('encodes the timestamp, version, and RFC variant', () => {
    const id = uuidv7(1_700_000_000_000);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(id.slice(0, 8)).toBe('018bcfe5');
  });

  it('produces distinct values for calls in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 64 }, () => uuidv7(1_700_000_000_000)));
    expect(ids.size).toBe(64);
  });

  it('rejects timestamps outside the 48-bit range', () => {
    expect(() => uuidv7(-1)).toThrow(RangeError);
    expect(() => uuidv7(0x1000000000000)).toThrow(RangeError);
  });
});

describe('time', () => {
  it('formats Jakarta time and calendar dates', () => {
    expect(formatClockTime('2026-10-25T03:42:00.000Z')).toBe('10.42 WIB');
  });

  it('formats timers without hiding the hour field', () => {
    expect(formatTimer(0)).toBe('00:00:00');
    expect(formatTimer(3_661)).toBe('01:01:01');
    expect(formatTimer(Number.NaN)).toBe('00:00:00');
  });

  it('formats human durations and Indonesian numbers', () => {
    expect(formatDurationMinutes(21 * 60)).toBe('21 menit');
    expect(formatDurationMinutes(90 * 60)).toBe('1 jam 30 menit');
    expect(formatNumber(1_234.56)).toBe('1.234,6');
  });

  it('clamps elapsed time at zero and handles invalid dates', () => {
    expect(elapsedSeconds('2026-10-25T03:42:00.000Z', Date.parse('2026-10-25T03:43:05.000Z'))).toBe(65);
    expect(elapsedSeconds('2026-10-25T03:42:00.000Z', Date.parse('2026-10-25T03:41:00.000Z'))).toBe(0);
    expect(elapsedSeconds('bukan-tanggal', Date.now())).toBe(0);
  });
});