export type RangePreset = '7d' | '30d' | '90d' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export type RangeIssue = 'incomplete' | 'reversed' | 'too_long' | 'future';

export const PRESETS: readonly RangePreset[] = ['7d', '30d', '90d', 'custom'];
export const MAX_RANGE_DAYS = 180;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function partsOf(day: string): { year: number; month: number; date: number } | null {
  if (!DAY_PATTERN.test(day)) {
    return null;
  }
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(year, month - 1, date));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== date
  ) {
    return null;
  }
  return { year, month, date };
}

export function readDay(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return partsOf(trimmed) === null ? null : trimmed;
}

export function todayDay(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayFromOffset(day: string, offset: number): string {
  const parts = partsOf(day);
  if (parts === null || !Number.isFinite(offset)) {
    return day;
  }
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.date) + offset * DAY_MS);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function presetDays(preset: Exclude<RangePreset, 'custom'>): number {
  if (preset === '7d') {
    return 7;
  }
  if (preset === '90d') {
    return 90;
  }
  return 30;
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, now: number): DateRange {
  const to = todayDay(now);
  return { from: dayFromOffset(to, -(presetDays(preset) - 1)), to };
}

export function readPreset(raw: unknown): RangePreset | null {
  return typeof raw === 'string' && (PRESETS as readonly string[]).includes(raw)
    ? (raw as RangePreset)
    : null;
}

export function readRange(raw: Record<string, unknown>, now: number): {
  preset: RangePreset;
  range: DateRange;
} {
  const from = readDay(raw.dari);
  const to = readDay(raw.sampai);
  if (from !== null && to !== null) {
    return { preset: 'custom', range: { from, to } };
  }
  const preset = readPreset(raw.rentang);
  if (preset === 'custom') {
    return { preset: '30d', range: presetRange('30d', now) };
  }
  if (preset !== null) {
    return { preset, range: presetRange(preset, now) };
  }
  return { preset: '30d', range: presetRange('30d', now) };
}

export function toRangeSearch(selection: { preset: RangePreset; range: DateRange }): {
  rentang?: string;
  dari?: string;
  sampai?: string;
} {
  if (selection.preset === 'custom') {
    const from = readDay(selection.range.from);
    const to = readDay(selection.range.to);
    if (from === null || to === null) {
      return {};
    }
    return { rentang: 'custom', dari: from, sampai: to };
  }
  return selection.preset === '30d' ? {} : { rentang: selection.preset };
}

export function dayStartIso(day: string): string | null {
  const parts = partsOf(day);
  if (parts === null) {
    return null;
  }
  return new Date(parts.year, parts.month - 1, parts.date, 0, 0, 0, 0).toISOString();
}

export function dayEndIso(day: string): string | null {
  const parts = partsOf(day);
  if (parts === null) {
    return null;
  }
  return new Date(parts.year, parts.month - 1, parts.date, 23, 59, 59, 999).toISOString();
}

export function rangeDays(range: DateRange): number | null {
  const from = partsOf(range.from);
  const to = partsOf(range.to);
  if (from === null || to === null) {
    return null;
  }
  const start = Date.UTC(from.year, from.month - 1, from.date);
  const end = Date.UTC(to.year, to.month - 1, to.date);
  const diff = Math.round((end - start) / DAY_MS);
  return diff < 0 ? null : diff + 1;
}

export function rangeIssues(range: DateRange, now: number, maxDays: number): RangeIssue | null {
  const from = readDay(range.from);
  const to = readDay(range.to);
  if (from === null && to === null) {
    return 'incomplete';
  }
  if (from === null || to === null) {
    return 'incomplete';
  }
  const days = rangeDays({ from, to });
  if (days === null) {
    return 'reversed';
  }
  if (Number.isFinite(maxDays) && days > maxDays) {
    return 'too_long';
  }
  if (to > todayDay(now)) {
    return 'future';
  }
  return null;
}

export function rangeIssueText(issue: RangeIssue, maxDays: number): string {
  if (issue === 'incomplete') {
    return 'Isi kedua tanggal, atau pilih salah satu rentang siap pakai.';
  }
  if (issue === 'reversed') {
    return 'Tanggal mulai harus sebelum atau sama dengan tanggal akhir.';
  }
  if (issue === 'too_long') {
    return `Rentang paling panjang ${maxDays} hari.`;
  }
  return 'Tanggal akhir belum terjadi. Pilih hari yang sudah lewat.';
}

export function toIsoRange(range: DateRange): { from?: string; to?: string } {
  const from = dayStartIso(range.from);
  const to = dayEndIso(range.to);
  const output: { from?: string; to?: string } = {};
  if (from !== null) {
    output.from = from;
  }
  if (to !== null) {
    output.to = to;
  }
  return output;
}