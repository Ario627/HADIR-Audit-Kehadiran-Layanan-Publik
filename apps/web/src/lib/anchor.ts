export const ANCHOR_SCAN_DAYS = 7;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ROOT_CHUNK = 11;
const SHORT_HEAD = 10;
const SHORT_TAIL = 6;

const DAY_FORMAT = new Intl.DateTimeFormat('id-ID', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const COUNT_FORMAT = new Intl.NumberFormat('id-ID');

export function readAnchorDate(raw: unknown): string | null {
  if (typeof raw !== 'string' || !DATE_PATTERN.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(raw)) {
    return null;
  }
  return raw;
}

export function utcDayString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function yesterdayUtc(now: Date): string {
  return utcDayString(new Date(now.getTime() - 86_400_000));
}

export function previousDays(fromDate: string, count: number): string[] {
  const start = readAnchorDate(fromDate);
  if (start === null || !Number.isFinite(count) || count <= 0) {
    return [];
  }
  const base = new Date(`${start}T00:00:00.000Z`).getTime();
  const days: string[] = [];
  for (let index = 0; index < Math.floor(count); index += 1) {
    days.push(utcDayString(new Date(base - index * 86_400_000)));
  }
  return days;
}

export function nextDayUtc(fromDate: string): string | null {
  const start = readAnchorDate(fromDate);
  if (start === null) {
    return null;
  }
  return utcDayString(new Date(new Date(`${start}T00:00:00.000Z`).getTime() + 86_400_000));
}

export function groupMerkleRoot(root: string): string[] {
  const cleaned = root.trim();
  if (cleaned.length === 0) {
    return [];
  }
  const chunks: string[] = [];
  for (let index = 0; index < cleaned.length; index += ROOT_CHUNK) {
    chunks.push(cleaned.slice(index, index + ROOT_CHUNK));
  }
  return chunks;
}

export function shortenRoot(root: string): string {
  const cleaned = root.trim();
  if (cleaned.length <= SHORT_HEAD + SHORT_TAIL + 1) {
    return cleaned;
  }
  return `${cleaned.slice(0, SHORT_HEAD)}…${cleaned.slice(-SHORT_TAIL)}`;
}

export function formatAnchorCount(count: number): string {
  if (!Number.isFinite(count) || count < 0) {
    return 'jumlah event tidak diketahui';
  }
  return `${COUNT_FORMAT.format(Math.floor(count))} event`;
}

export function anchorDateLabel(date: string): string {
  const valid = readAnchorDate(date);
  if (valid === null) {
    return 'tanggal tidak dikenal';
  }
  return DAY_FORMAT.format(new Date(`${valid}T00:00:00.000Z`));
}

export function anchorDayCount(count: number): string {
  return count === 1 ? '1 hari' : `${count} hari`;
}