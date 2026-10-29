import type { RunwayEventKind, RunwayStatus, UrgencyBand } from '@hadir/contracts';

export interface RunwayClock {
  today: string;
}

const DAY_MS = 86_400_000;

export function jakartaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function daysBetween(fromIso: string, toIso: string): number | null {
  const from = Date.parse(`${fromIso}T00:00:00.000Z`);
  const to = Date.parse(`${toIso}T00:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return Math.round((to - from) / DAY_MS);
}

export function daysRemaining(
  fundedUntil: string | null,
  clock: RunwayClock,
): number | null {
  return fundedUntil === null ? null : daysBetween(clock.today, fundedUntil);
}

export function deriveStatus(input: {
  declared: RunwayStatus;
  fundedUntil: string | null;
  clock: RunwayClock;
}): RunwayStatus {
  if (input.declared === 'stopped') {
    return 'stopped';
  }
  const remaining = daysRemaining(input.fundedUntil, input.clock);
  if (remaining === null) {
    return input.declared;
  }
  if (remaining < 0) {
    return input.declared === 'funded' ? 'pending' : input.declared;
  }
  if (input.declared === 'unknown' || input.declared === 'pending') {
    return 'funded';
  }
  return input.declared;
}

export function urgencyBand(remaining: number | null): UrgencyBand {
  if (remaining === null) {
    return 'none';
  }
  if (remaining < 0) {
    return 'expired';
  }
  if (remaining <= 30) {
    return 'critical';
  }
  if (remaining <= 90) {
    return 'warning';
  }
  return 'watch';
}

export function latestMeaningfulEvent<T extends { seq: number; kind: RunwayEventKind }>(
  events: readonly T[],
): T | null {
  let latest: T | null = null;
  for (const event of events) {
    if (latest === null || event.seq > latest.seq) {
      latest = event;
    }
  }
  return latest;
}

export function disclaimerFor(): string {
  return 'Tanggal adalah batas pendanaan yang dilaporkan, bukan prediksi penghentian layanan.';
}

export function sanctionsFor(note: string | null): string[] {
  if (note === null) {
    return [];
  }
  return note
    .split(/[.;\n]/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}