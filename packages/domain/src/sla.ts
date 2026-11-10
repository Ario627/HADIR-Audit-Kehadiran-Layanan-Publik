export type ReportPhaseCategory =
  | 'service_wait'
  | 'service_no_show'
  | 'service_full'
  | 'stop_facility'
  | 'stop_cleanliness'
  | 'stop_safety'
  | 'route_info'
  | 'accessibility'
  | 'other';

export type SlaPriority = 'low' | 'normal' | 'high' | 'critical';

export type SlaPhase = 'acknowledge' | 'respond' | 'resolve';

export type SlaState = 'not_started' | 'pending' | 'met' | 'overdue' | 'met_late';

export type EscalationLevel = 0 | 1 | 2 | 3;

export interface SlaTargets {
  acknowledgeHours: number;
  respondHours: number;
  resolveHours: number;
}

export interface SlaPolicyEntry extends SlaTargets {
  category: ReportPhaseCategory;
  priority: SlaPriority;
}

export interface SlaMilestones {
  submittedAt: string;
  acknowledgedAt: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
}

export interface SlaPhaseResult {
  phase: SlaPhase;
  dueAt: string;
  metAt: string | null;
  state: SlaState;
  lateByHours: number | null;
  remainingHours: number | null;
}

export interface SlaReport {
  policyVersion: string;
  priority: SlaPriority;
  targets: SlaTargets;
  phases: readonly SlaPhaseResult[];
  breached: boolean;
  worstState: SlaState;
  escalation: EscalationLevel;
  frozenAt: string;
}

const HOUR_MS = 3_600_000;

export const SLA_POLICY_VERSION = 'sla-v1';

export interface SlaTargetOverride {
  cityId: string;
  priority: SlaPriority;
  acknowledgeHours: number;
  respondHours: number;
  resolveHours: number;
  sourceUrl: string;
}

export interface ResolvedTargets {
  targets: SlaTargets;
  source: 'city_override' | 'base_policy';
  cityId: string | null;
  note: string;
}

const BASE_TARGETS: Readonly<Record<SlaPriority, SlaTargets>> = Object.freeze({
  critical: { acknowledgeHours: 2, respondHours: 8, resolveHours: 24 },
  high: { acknowledgeHours: 8, respondHours: 24, resolveHours: 72 },
  normal: { acknowledgeHours: 24, respondHours: 72, resolveHours: 168 },
  low: { acknowledgeHours: 72, respondHours: 168, resolveHours: 720 },
});

const CATEGORY_PRIORITY: Readonly<Record<ReportPhaseCategory, SlaPriority>> =
  Object.freeze({
    stop_safety: 'critical',
    service_no_show: 'high',
    accessibility: 'high',
    stop_facility: 'normal',
    stop_cleanliness: 'normal',
    service_wait: 'normal',
    service_full: 'normal',
    route_info: 'low',
    other: 'low',
  });

const PRIORITY_ORDER: readonly SlaPriority[] = ['low', 'normal', 'high', 'critical'];

const PHASE_ORDER: readonly SlaPhase[] = ['acknowledge', 'respond', 'resolve'];

const STATE_RANK: Readonly<Record<SlaState, number>> = Object.freeze({
  met: 0,
  met_late: 1,
  not_started: 2,
  pending: 3,
  overdue: 4,
});

const ESCALATION_PENDING: Readonly<Record<SlaState, EscalationLevel>> = Object.freeze({
  met: 0,
  met_late: 1,
  not_started: 0,
  pending: 0,
  overdue: 2,
});

function hoursBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return (end - start) / HOUR_MS;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function addHours(iso: string, hours: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) {
    throw new Error('Waktu dasar SLA tidak valid.');
  }
  return new Date(base + hours * HOUR_MS).toISOString();
}

export function priorityRank(priority: SlaPriority): number {
  const index = PRIORITY_ORDER.indexOf(priority);
  return index < 0 ? 0 : index;
}

export function raisePriority(priority: SlaPriority, steps: number): SlaPriority {
  const index = Math.min(
    PRIORITY_ORDER.length - 1,
    Math.max(0, priorityRank(priority) + Math.trunc(steps)),
  );
  return PRIORITY_ORDER[index] ?? 'normal';
}

export function slaPriorityFor(
  category: ReportPhaseCategory,
  evidenceLevel: 'none' | 'indication' | 'strong' | 'field_verified',
): SlaPriority {
  const base = CATEGORY_PRIORITY[category] ?? 'normal';
  const strengthened = evidenceLevel === 'strong' || evidenceLevel === 'field_verified';
  const raised = strengthened ? raisePriority(base, 1) : base;
  if (category === 'stop_safety' && priorityRank(raised) < priorityRank('high')) {
    return 'high';
  }
  return raised;
}

export function slaTargetsFor(priority: SlaPriority): SlaTargets {
  const targets = BASE_TARGETS[priority];
  return {
    acknowledgeHours: targets.acknowledgeHours,
    respondHours: targets.respondHours,
    resolveHours: targets.resolveHours,
  };
}

export function resolveSlaTargets(
  priority: SlaPriority,
  cityId: string | null,
  overrides: readonly SlaTargetOverride[],
): ResolvedTargets {
  const base = slaTargetsFor(priority);
  if (cityId === null) {
    return {
      targets: base,
      source: 'base_policy',
      cityId: null,
      note: 'Laporan tanpa kota memakai target dasar.',
    };
  }
  const match = overrides.find(
    (entry) => entry.cityId === cityId && entry.priority === priority,
  );
  if (match === undefined) {
    return {
      targets: base,
      source: 'base_policy',
      cityId,
      note: 'Kota ini memakai target dasar.',
    };
  }
  const overridden: SlaTargets = {
    acknowledgeHours: match.acknowledgeHours,
    respondHours: match.respondHours,
    resolveHours: match.resolveHours,
  };
  if (
    overridden.acknowledgeHours <= 0 ||
    overridden.respondHours < overridden.acknowledgeHours ||
    overridden.resolveHours < overridden.respondHours
  ) {
    return {
      targets: base,
      source: 'base_policy',
      cityId,
      note: 'Override kota tidak konsisten; target dasar dipakai.',
    };
  }
  if (
    overridden.acknowledgeHours > base.acknowledgeHours ||
    overridden.resolveHours > base.resolveHours
  ) {
    return {
      targets: base,
      source: 'base_policy',
      cityId,
      note: 'Override kota lebih longgar dari target dasar; ditolak.',
    };
  }
  return {
    targets: overridden,
    source: 'city_override',
    cityId,
    note: 'Target kota berlaku dan tidak boleh lebih longgar dari target dasar.',
  };
}

export function slaPolicyEntry(
  category: ReportPhaseCategory,
  evidenceLevel: 'none' | 'indication' | 'strong' | 'field_verified',
): SlaPolicyEntry {
  const priority = slaPriorityFor(category, evidenceLevel);
  return { category, priority, ...slaTargetsFor(priority) };
}

export function slaDeadlines(
  submittedAt: string,
  targets: SlaTargets,
): Readonly<Record<SlaPhase, string>> {
  return {
    acknowledge: addHours(submittedAt, targets.acknowledgeHours),
    respond: addHours(submittedAt, targets.respondHours),
    resolve: addHours(submittedAt, targets.resolveHours),
  };
}

function phaseState(
  dueAt: string,
  metAt: string | null,
  now: string,
): { state: SlaState; lateByHours: number | null; remainingHours: number | null } {
  if (metAt === null) {
    const remaining = hoursBetween(now, dueAt);
    if (remaining === null) {
      return { state: 'not_started', lateByHours: null, remainingHours: null };
    }
    return remaining >= 0
      ? { state: 'pending', lateByHours: null, remainingHours: round1(remaining) }
      : { state: 'overdue', lateByHours: round1(-remaining), remainingHours: null };
  }
  const late = hoursBetween(dueAt, metAt);
  if (late === null) {
    return { state: 'met', lateByHours: null, remainingHours: null };
  }
  return late <= 0
    ? { state: 'met', lateByHours: null, remainingHours: null }
    : { state: 'met_late', lateByHours: round1(late), remainingHours: null };
}

function metAtFor(phase: SlaPhase, milestones: SlaMilestones): string | null {
  switch (phase) {
    case 'acknowledge':
      return milestones.acknowledgedAt;
    case 'respond':
      return milestones.respondedAt;
    case 'resolve':
      return milestones.resolvedAt;
  }
}

export function slaReport(
  milestones: SlaMilestones,
  priority: SlaPriority,
  now: string,
): SlaReport {
  const targets = slaTargetsFor(priority);
  const deadlines = slaDeadlines(milestones.submittedAt, targets);
  const phases: SlaPhaseResult[] = PHASE_ORDER.map((phase) => {
    const metAt = metAtFor(phase, milestones);
    const dueAt = deadlines[phase];
    const computed = phaseState(dueAt, metAt, now);
    return { phase, dueAt, metAt, ...computed };
  });
  const breached = phases.some(
    (phase) => phase.state === 'overdue' || phase.state === 'met_late',
  );
  const worstState = phases.reduce<SlaState>(
    (worst, phase) =>
      STATE_RANK[phase.state] > STATE_RANK[worst] ? phase.state : worst,
    'met',
  );
  const escalationBase = ESCALATION_PENDING[worstState];
  const overduePhases = phases.filter((phase) => phase.state === 'overdue').length;
  const escalation = Math.min(3, escalationBase + Math.max(0, overduePhases - 1)) as
    EscalationLevel;
  return {
    policyVersion: SLA_POLICY_VERSION,
    priority,
    targets,
    phases,
    breached,
    worstState,
    escalation,
    frozenAt: milestones.submittedAt,
  };
}

export interface SlaFreeze {
  policyVersion: string;
  priority: SlaPriority;
  targets: SlaTargets;
  deadlines: Readonly<Record<SlaPhase, string>>;
}

export function slaFreeze(
  category: ReportPhaseCategory,
  evidenceLevel: 'none' | 'indication' | 'strong' | 'field_verified',
  submittedAt: string,
): SlaFreeze {
  const entry = slaPolicyEntry(category, evidenceLevel);
  const targets: SlaTargets = {
    acknowledgeHours: entry.acknowledgeHours,
    respondHours: entry.respondHours,
    resolveHours: entry.resolveHours,
  };
  return {
    policyVersion: SLA_POLICY_VERSION,
    priority: entry.priority,
    targets,
    deadlines: slaDeadlines(submittedAt, targets),
  };
}

export function slaBreaches(report: SlaReport): readonly SlaPhaseResult[] {
  return report.phases.filter(
    (phase) => phase.state === 'overdue' || phase.state === 'met_late',
  );
}

export function slaEscalationLine(report: SlaReport): string {
  if (!report.breached) {
    const pending = report.phases.find((phase) => phase.state === 'pending');
    if (pending === undefined) {
      return 'Tidak ada tenggat yang terlewat.';
    }
    return `Tahap ${pending.phase} masih berjalan, sisa ${pending.remainingHours} jam.`;
  }
  const breached = slaBreaches(report);
  const labels: Readonly<Record<SlaPhase, string>> = {
    acknowledge: 'pengakuan',
    respond: 'tanggapan',
    resolve: 'penyelesaian',
  };
  const parts = breached.map((phase) => {
    const late = phase.lateByHours ?? 0;
    return `${labels[phase.phase]} terlambat ${late} jam`;
  });
  return `Tenggat terlewat: ${parts.join('; ')} (eskalasi ${report.escalation}).`;
}

export function slaCaveats(): readonly string[] {
  return [
    'Tenggat dihitung dari waktu laporan diterima, bukan waktu moderasi.',
    'Target disalin saat laporan dibuat; mengubah kebijakan tidak mengubah tenggat laporan lama.',
    'Terlambat bukan berarti tidak dikerjakan, dan tepat waktu bukan berarti masalah selesai.',
    'SLA mengukur proses instansi, bukan kualitas perbaikan di lapangan.',
  ];
}

export function describeSlaPhase(phase: SlaPhaseResult): string {
  const labels: Readonly<Record<SlaPhase, string>> = {
    acknowledge: 'Pengakuan',
    respond: 'Tanggapan',
    resolve: 'Penyelesaian',
  };
  const label = labels[phase.phase];
  switch (phase.state) {
    case 'met':
      return `${label} tepat waktu.`;
    case 'met_late':
      return `${label} terlambat ${phase.lateByHours} jam.`;
    case 'pending':
      return `${label} tersisa ${phase.remainingHours} jam.`;
    case 'overdue':
      return `${label} lewat ${phase.lateByHours} jam.`;
    case 'not_started':
      return `${label} belum dapat dihitung.`;
  }
}
