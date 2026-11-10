import type { SlaMilestones } from './sla';

export type ReportEventKind =
  | 'submitted'
  | 'triaged'
  | 'acknowledged'
  | 'info_requested'
  | 'scheduled'
  | 'responded'
  | 'claimed_resolved'
  | 'verified_resolved'
  | 'disputed'
  | 'rejected'
  | 'moderated'
  | 'corrected';

export type MilestoneKey =
  | 'submitted'
  | 'triaged'
  | 'acknowledged'
  | 'scheduled'
  | 'responded'
  | 'claimed_resolved'
  | 'verified_resolved'
  | 'disputed'
  | 'rejected';

export type TerminalOutcome = 'resolved' | 'disputed' | 'rejected' | null;

export interface MilestoneEvent {
  seq: number;
  kind: ReportEventKind;
  actorType: string;
  actorId: string | null;
  createdAt: string;
}

export interface MilestoneEntry {
  key: MilestoneKey;
  seq: number;
  at: string;
  actorType: string;
  actorId: string | null;
}

export interface MilestoneTracker {
  entries: readonly MilestoneEntry[];
  current: MilestoneKey | null;
  next: MilestoneKey | null;
  progress: number;
  terminal: TerminalOutcome;
  pendingInfoRequest: boolean;
}

const MILESTONE_ORDER: readonly MilestoneKey[] = [
  'submitted',
  'triaged',
  'acknowledged',
  'scheduled',
  'responded',
  'claimed_resolved',
  'verified_resolved',
];

const TERMINAL_KEYS: readonly MilestoneKey[] = [
  'verified_resolved',
  'disputed',
  'rejected',
];

const EVENT_TO_MILESTONE: Readonly<Record<ReportEventKind, MilestoneKey | null>> =
  Object.freeze({
    submitted: 'submitted',
    triaged: 'triaged',
    acknowledged: 'acknowledged',
    info_requested: null,
    scheduled: 'scheduled',
    responded: 'responded',
    claimed_resolved: 'claimed_resolved',
    verified_resolved: 'verified_resolved',
    disputed: 'disputed',
    rejected: 'rejected',
    moderated: null,
    corrected: null,
  });

const LABELS: Readonly<Record<MilestoneKey, string>> = Object.freeze({
  submitted: 'Laporan diterima',
  triaged: 'Triase awal',
  acknowledged: 'Diakui instansi',
  scheduled: 'Dijadwalkan',
  responded: 'Ditanggapi',
  claimed_resolved: 'Diklaim selesai',
  verified_resolved: 'Selesai terverifikasi',
  disputed: 'Hasil disengketakan',
  rejected: 'Ditolak dengan alasan',
});

export function milestoneOfEvent(kind: ReportEventKind): MilestoneKey | null {
  return EVENT_TO_MILESTONE[kind] ?? null;
}

export function milestoneSequence(): readonly MilestoneKey[] {
  return MILESTONE_ORDER;
}

export function milestoneLabel(key: MilestoneKey): string {
  return LABELS[key];
}

export function isTerminalMilestone(key: MilestoneKey): boolean {
  return TERMINAL_KEYS.includes(key);
}

export function milestoneCompletionByEvents(events: readonly MilestoneEvent[]): MilestoneTracker {
  const sorted = [...events].sort((left, right) => left.seq - right.seq);
  const entries: MilestoneEntry[] = [];
  const seen = new Set<MilestoneKey>();
  let pendingInfoRequest = false;

  for (const event of sorted) {
    const key = milestoneOfEvent(event.kind);
    if (event.kind === 'info_requested') {
      pendingInfoRequest = true;
    }
    if (event.kind === 'responded') {
      pendingInfoRequest = false;
    }
    if (key === null || seen.has(key)) {
      continue;
    }
    seen.add(key);
    entries.push({
      key,
      seq: event.seq,
      at: event.createdAt,
      actorType: event.actorType,
      actorId: event.actorId,
    });
  }

  const terminalEntry = entries.find((entry) => isTerminalMilestone(entry.key));
  const terminal: TerminalOutcome =
    terminalEntry === undefined
      ? null
      : terminalEntry.key === 'verified_resolved'
        ? 'resolved'
        : terminalEntry.key === 'disputed'
          ? 'disputed'
          : 'rejected';

  const reached = new Set(entries.map((entry) => entry.key));
  const current =
    terminalEntry?.key ??
    [...MILESTONE_ORDER].reverse().find((key) => reached.has(key)) ??
    null;
  const currentIndex = current === null ? -1 : MILESTONE_ORDER.indexOf(current);
  const next =
    terminal !== null
      ? null
      : (MILESTONE_ORDER.slice(currentIndex + 1)[0] ?? null);
  const progress =
    terminal !== null
      ? 1
      : MILESTONE_ORDER.length === 0
        ? 0
        : Math.round((reached.size / MILESTONE_ORDER.length) * 1000) / 1000;

  return { entries, current, next, progress, terminal, pendingInfoRequest };
}

export function slaMilestonesFrom(events: readonly MilestoneEvent[]): SlaMilestones {
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  let submittedAt: string | null = null;
  let acknowledgedAt: string | null = null;
  let respondedAt: string | null = null;
  let resolvedAt: string | null = null;

  for (const event of ordered) {
    switch (event.kind) {
      case 'submitted':
        submittedAt ??= event.createdAt;
        break;
      case 'acknowledged':
        acknowledgedAt ??= event.createdAt;
        break;
      case 'responded':
        respondedAt ??= event.createdAt;
        break;
      case 'verified_resolved':
        resolvedAt ??= event.createdAt;
        break;
      default:
        break;
    }
  }

  return {
    submittedAt: submittedAt ?? ordered[0]?.createdAt ?? new Date(0).toISOString(),
    acknowledgedAt,
    respondedAt,
    resolvedAt,
  };
}

export function milestoneGaps(tracker: MilestoneTracker): readonly MilestoneKey[] {
  if (tracker.terminal !== null) {
    return [];
  }
  const reached = new Set(tracker.entries.map((entry) => entry.key));
  return MILESTONE_ORDER.filter((key) => !reached.has(key));
}

export function milestoneCaveats(): readonly string[] {
  return [
    'Tahapan berasal dari catatan peristiwa ber-hash, sehingga urutannya tidak dapat disunting ulang.',
    'Tahapan menunjukkan proses, bukan mutu hasil di lapangan.',
    'Peristiwa administratif seperti moderasi tidak dihitung sebagai kemajuan.',
    'Laporan yang ditolak atau disengketakan berhenti sebagai terminal, bukan progress 100%.',
  ];
}

export function describeMilestone(tracker: MilestoneTracker): string {
  if (tracker.terminal === 'resolved') {
    return 'Selesai dan sudah diverifikasi pihak independen.';
  }
  if (tracker.terminal === 'disputed') {
    return 'Klaim selesai dibantah verifikasi; laporan kembali terbuka.';
  }
  if (tracker.terminal === 'rejected') {
    return 'Ditolak dengan alasan tertulis.';
  }
  if (tracker.current === null) {
    return 'Belum ada tahapan tercatat.';
  }
  const next = tracker.next === null ? 'tidak ada tahap berikutnya' : milestoneLabel(tracker.next);
  return `Tahap terakhir: ${milestoneLabel(tracker.current)}. Berikutnya: ${next}.`;
}
