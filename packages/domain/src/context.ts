export type IncidentImpact = 'none' | 'minor' | 'major' | 'service_stopped';

export type OperationalKind =
  | 'detour'
  | 'repair'
  | 'suspension'
  | 'schedule'
  | 'other';

export interface OperationalEvent {
  id: string;
  kind: OperationalKind | string;
  impact: IncidentImpact;
  text: string;
  sourceUrl: string;
  startsAt: string | null;
  endsAt: string | null;
  stopId: string | null;
  routeId: string | null;
  acknowledgedAt: string | null;
}

export interface ObservationMoment {
  at: string;
  day: string;
  hour: number;
}

export interface EventWindow {
  id: string;
  start: string;
  end: string;
  impact: IncidentImpact;
  openEnded: boolean;
  openStart: boolean;
}

export interface TimelineSegment {
  start: string;
  end: string;
  impact: IncidentImpact;
  eventIds: readonly string[];
}

export interface AnnotationResult {
  total: number;
  annotated: number;
  uncovered: number;
  byEvent: readonly { eventId: string; impact: IncidentImpact; count: number }[];
  annotatedShare: number;
  worstImpact: IncidentImpact | null;
}

export interface OperationalContextSummary {
  events: readonly OperationalEvent[];
  windows: readonly EventWindow[];
  segments: readonly TimelineSegment[];
  dominantImpact: IncidentImpact | null;
  caveats: readonly string[];
}

const IMPACT_ORDER: readonly IncidentImpact[] = [
  'none',
  'minor',
  'major',
  'service_stopped',
];

const FAR_PAST = '1970-01-01T00:00:00.000Z';
const FAR_FUTURE = '9999-12-31T23:59:59.999Z';
const DEFAULT_EVENT_HOURS = 4;
const HOUR_MS = 3_600_000;

function parseIso(raw: string): Date | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function impactRank(impact: IncidentImpact): number {
  return IMPACT_ORDER.indexOf(impact);
}

export function worstImpact(
  left: IncidentImpact | null,
  right: IncidentImpact | null,
): IncidentImpact | null {
  if (left === null) {
    return right;
  }
  if (right === null) {
    return left;
  }
  return impactRank(left) >= impactRank(right) ? left : right;
}

export function eventWindow(event: OperationalEvent, now: string): EventWindow {
  const start = event.startsAt === null ? null : parseIso(event.startsAt);
  const end = event.endsAt === null ? null : parseIso(event.endsAt);
  const nowDate = parseIso(now);

  let resolvedStart: Date;
  let openStart = false;
  if (start !== null) {
    resolvedStart = start;
  } else if (end !== null) {
    resolvedStart = new Date(end.getTime() - DEFAULT_EVENT_HOURS * HOUR_MS);
    openStart = true;
  } else {
    resolvedStart = new Date(FAR_PAST);
    openStart = true;
  }

  let resolvedEnd: Date;
  let openEnded = false;
  if (end !== null) {
    resolvedEnd = end;
  } else if (nowDate !== null && nowDate.getTime() > resolvedStart.getTime()) {
    resolvedEnd = nowDate;
    openEnded = true;
  } else {
    resolvedEnd = new Date(FAR_FUTURE);
    openEnded = true;
  }

  if (resolvedEnd.getTime() < resolvedStart.getTime()) {
    resolvedEnd = resolvedStart;
  }

  return {
    id: event.id,
    start: resolvedStart.toISOString(),
    end: resolvedEnd.toISOString(),
    impact: event.impact,
    openEnded,
    openStart,
  };
}

export function eventWindows(
  events: readonly OperationalEvent[],
  now: string,
): readonly EventWindow[] {
  return events
    .map((event) => eventWindow(event, now))
    .slice()
    .sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
}

export function mergeTimeline(
  windows: readonly EventWindow[],
): readonly TimelineSegment[] {
  const ordered = windows
    .filter((window) => window.impact !== 'none')
    .slice()
    .sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));

  const segments: TimelineSegment[] = [];
  for (const window of ordered) {
    const previous = segments[segments.length - 1];
    if (previous === undefined || window.start > previous.end) {
      segments.push({
        start: window.start,
        end: window.end,
        impact: window.impact,
        eventIds: [window.id],
      });
      continue;
    }
    const merged: TimelineSegment = {
      start: previous.start,
      end: window.end > previous.end ? window.end : previous.end,
      impact: worstImpact(previous.impact, window.impact) ?? previous.impact,
      eventIds: [...new Set([...previous.eventIds, window.id])],
    };
    segments[segments.length - 1] = merged;
  }
  return segments;
}

function within(moment: string, window: EventWindow): boolean {
  const at = parseIso(moment);
  if (at === null) {
    return false;
  }
  const start = parseIso(window.start);
  const end = parseIso(window.end);
  if (start === null || end === null) {
    return false;
  }
  return at.getTime() >= start.getTime() && at.getTime() <= end.getTime();
}

export function annotateObservations(
  observations: readonly ObservationMoment[],
  events: readonly OperationalEvent[],
  now: string,
): AnnotationResult {
  const windows = eventWindows(events, now);
  const counts = new Map<string, { impact: IncidentImpact; count: number }>();
  let annotated = 0;
  let dominant: IncidentImpact | null = null;

  for (const observation of observations) {
    let matched = false;
    for (const window of windows) {
      if (window.impact === 'none') {
        continue;
      }
      if (!within(observation.at, window)) {
        continue;
      }
      matched = true;
      const current = counts.get(window.id);
      counts.set(window.id, {
        impact: window.impact,
        count: (current?.count ?? 0) + 1,
      });
      dominant = worstImpact(dominant, window.impact);
    }
    if (matched) {
      annotated += 1;
    }
  }

  const total = observations.length;
  return {
    total,
    annotated,
    uncovered: total - annotated,
    byEvent: [...counts]
      .map(([eventId, entry]) => ({ eventId, impact: entry.impact, count: entry.count }))
      .sort((left, right) => right.count - left.count),
    annotatedShare: total === 0 ? 0 : round3(annotated / total),
    worstImpact: dominant,
  };
}

export function annotateByDayHour(
  moments: readonly ObservationMoment[],
  events: readonly OperationalEvent[],
  now: string,
): AnnotationResult {
  return annotateObservations(moments, events, now);
}

export function summariseContext(
  events: readonly OperationalEvent[],
  now: string,
): OperationalContextSummary {
  const windows = eventWindows(events, now);
  const segments = mergeTimeline(windows);
  let dominant: IncidentImpact | null = null;
  for (const event of events) {
    dominant = worstImpact(dominant, event.impact);
  }
  return {
    events,
    windows,
    segments,
    dominantImpact: dominant,
    caveats: contextCaveats(),
  };
}

export function contextCaveats(): readonly string[] {
  return Object.freeze([
    'Gangguan operasional menjelaskan konteks, bukan menghapus pengamatan. Tidak ada observasi yang dibuang otomatis.',
    'Pengumuman tanpa sumber resmi tidak boleh dipakai sebagai alasan menurunkan temuan.',
    'Klarifikasi operator dicatat dengan waktu dan sumbernya; hak menjawab tidak mengubah angka yang sudah terukur.',
    'Periode yang bertanda "service_stopped" tetap dilaporkan; pembaca yang menilai apakah keterlambatan wajar.',
  ]);
}

export function describedPeriod(
  segment: TimelineSegment,
  format: (iso: string) => string,
): string {
  const impactLabel: Readonly<Record<IncidentImpact, string>> = {
    none: 'normal',
    minor: 'gangguan ringan',
    major: 'gangguan besar',
    service_stopped: 'layanan berhenti',
  };
  return `${format(segment.start)} sampai ${format(segment.end)}: ${impactLabel[segment.impact]} (${segment.eventIds.length} catatan).`;
}

export function contextWarningCode(result: AnnotationResult): string | null {
  if (result.total === 0 || result.annotated === 0) {
    return null;
  }
  if (result.worstImpact === 'service_stopped') {
    return 'context_service_stopped';
  }
  if (result.annotatedShare >= 0.5) {
    return 'context_explained_majority';
  }
  return 'context_partial_overlap';
}

export function contextMessage(result: AnnotationResult): string | null {
  if (result.annotated === 0) {
    return null;
  }
  const share = Math.round(result.annotatedShare * 100);
  if (result.worstImpact === 'service_stopped') {
    return `${share}% pengamatan berada dalam periode layanan berhenti menurut pengumuman resmi. Angka tetap ditampilkan tanpa penyesuaian; observasi tidak dihapus.`;
  }
  if (result.annotatedShare >= 0.5) {
    return `${share}% pengamatan bertepatan dengan gangguan operasional yang diumumkan. Pertimbangkan konteks ini sebelum menyimpulkan.`;
  }
  return `${share}% pengamatan bertepatan dengan gangguan operasional yang diumumkan.`;
}

export function withinAnyWindow(moment: string, windows: readonly EventWindow[]): boolean {
  return windows.some((window) => within(moment, window));
}

export function windowDurationMinutes(window: EventWindow): number {
  const start = parseIso(window.start);
  const end = parseIso(window.end);
  if (start === null || end === null) {
    return 0;
  }
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
}

export function requiresAcknowledgement(impact: IncidentImpact): boolean {
  return impact === 'major' || impact === 'service_stopped';
}
