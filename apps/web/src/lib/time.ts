export const JAKARTA_TIME_ZONE = 'Asia/Jakarta';

const clockFormatter = new Intl.DateTimeFormat('id-ID', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: JAKARTA_TIME_ZONE,
});

const dateFormatter = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: JAKARTA_TIME_ZONE,
});

const numberFormatters = new Map<number, Intl.NumberFormat>();

function toDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

export function formatClockTime(value: string | Date): string {
  const date = toDate(value);
  return date === null ? '—' : `${clockFormatter.format(date)} WIB`;
}

export function formatDate(value: string | Date): string {
  const date = toDate(value);
  return date === null ? '—' : dateFormatter.format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = toDate(value);
  return date === null ? '—' : `${dateFormatter.format(date)} · ${clockFormatter.format(date)} WIB`;
}

export function formatTimer(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = safe % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

export function formatDurationMinutes(totalSeconds: number): string {
  const minutes = Number.isFinite(totalSeconds)
    ? Math.max(0, Math.floor(totalSeconds / 60))
    : 0;
  if (minutes < 1) {
    return 'kurang dari 1 menit';
  }
  if (minutes < 60) {
    return `${minutes} menit`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} jam` : `${hours} jam ${rest} menit`;
}

export function formatMinutesShort(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return '—';
  }
  const rounded = Math.round(minutes);
  if (rounded < 60) {
    return `${rounded} mnt`;
  }
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours} j` : `${hours} j ${rest} mnt`;
}

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  if (!Number.isFinite(value)) {
    return '—';
  }
  const digits = Math.min(3, Math.max(0, Math.trunc(maximumFractionDigits)));
  let formatter = numberFormatters.get(digits);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat('id-ID', { maximumFractionDigits: digits });
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}

export function elapsedSeconds(startedAt: string | Date, now: number = Date.now()): number {
  const started = toDate(startedAt);
  if (started === null) {
    return 0;
  }
  return Math.max(0, Math.floor((now - started.getTime()) / 1_000));
}