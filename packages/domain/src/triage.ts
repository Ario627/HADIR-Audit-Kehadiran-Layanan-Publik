import type { Direction, EvidenceLevel } from './evidence';

export type TriageVerdict =
  | 'join'
  | 'already_planned'
  | 'wrong_authority'
  | 'service_not_running'
  | 'data_supports'
  | 'data_insufficient'
  | 'new_report';

export type TriageActionKind =
  | 'join'
  | 'monitor'
  | 'send_elsewhere'
  | 'measure'
  | 'send_anyway'
  | 'open_radar';

export type ConnectorState = 'ok' | 'unavailable' | 'not_configured';

export type SourceTier = 'T1' | 'T2' | 'T3' | 'T4';

export interface EvidenceRef {
  id: string;
  tier: SourceTier;
  matchScore: number | null;
}

export interface AuthorityMatch {
  institutionId: string;
  institutionName: string;
}

export interface EstimateSignal {
  level: EvidenceLevel;
  direction: Direction;
  n: number;
}

export interface TriageFacts {
  duplicateCount: number;
  duplicatesAvailable: boolean;
  planned: readonly EvidenceRef[];
  plannedAvailable: boolean;
  authority: AuthorityMatch | null;
  authorityAvailable: boolean;
  pilotInstitutionId: string | null;
  serviceRunning: boolean | null;
  radarAvailable: boolean;
  estimate: EstimateSignal | null;
  categoryIsService: boolean;
  connectors: Readonly<Record<string, ConnectorState>>;
}

export interface TriageDecision {
  verdict: TriageVerdict;
  actions: readonly TriageActionKind[];
  citedEvidenceIds: readonly string[];
  reasons: readonly string[];
  requiresHumanConfirmation: boolean;
}

const PLANNED_TIERS = new Set<SourceTier>(['T1', 'T2']);
const MIN_N = 15;
const POSSIBLE_MATCH = 0.7;

function actionsFor(verdict: TriageVerdict): TriageActionKind[] {
  switch (verdict) {
    case 'join':
      return ['join', 'monitor', 'send_anyway'];
    case 'already_planned':
      return ['monitor', 'send_anyway'];
    case 'wrong_authority':
      return ['send_elsewhere', 'send_anyway'];
    case 'service_not_running':
      return ['open_radar', 'send_anyway'];
    case 'data_supports':
      return ['monitor', 'send_anyway'];
    case 'data_insufficient':
      return ['measure', 'send_anyway'];
    case 'new_report':
      return ['send_anyway'];
  }
}

function decide(input: TriageFacts): {
  verdict: TriageVerdict;
  reasons: string[];
  cited: string[];
} {
  if (input.duplicatesAvailable && input.duplicateCount > 0) {
    return {
      verdict: 'join',
      reasons: [`Ada ${input.duplicateCount} laporan serupa dalam 60 hari terakhir.`],
      cited: [],
    };
  }

  if (
    input.authorityAvailable &&
    input.authority !== null &&
    input.pilotInstitutionId !== null &&
    input.authority.institutionId !== input.pilotInstitutionId
  ) {
    return {
      verdict: 'wrong_authority',
      reasons: [
        `Kewenangan tercatat pada ${input.authority.institutionName}, bukan instansi mitra.`,
      ],
      cited: [],
    };
  }

  if (input.plannedAvailable) {
    const planned = input.planned.filter((item) => PLANNED_TIERS.has(item.tier));
    if (planned.length > 0) {
      const best = planned.reduce((top, item) =>
        (item.matchScore ?? 0) > (top.matchScore ?? 0) ? item : top,
      );
      return {
        verdict: 'already_planned',
        reasons: [
          `Ada ${planned.length} bukti perencanaan resmi (${[...new Set(planned.map((item) => item.tier))].join(', ')}).`,
        ],
        cited: [best.id],
      };
    }
  }

  if (input.radarAvailable && input.serviceRunning === false) {
    return {
      verdict: 'service_not_running',
      reasons: ['Radar mencatat layanan tidak berjalan pada periode ini.'],
      cited: [],
    };
  }

  if (input.categoryIsService && input.estimate !== null) {
    if (input.estimate.level !== 'none') {
      return {
        verdict: 'data_supports',
        reasons: [
          `Estimasi halte berlevel ${input.estimate.level} dengan ${input.estimate.n} episode.`,
        ],
        cited: [],
      };
    }
    if (input.estimate.n < MIN_N) {
      return {
        verdict: 'data_insufficient',
        reasons: [`Baru ${input.estimate.n} episode; ambang minimum ${MIN_N}.`],
        cited: [],
      };
    }
  }

  return { verdict: 'new_report', reasons: [], cited: [] };
}

export function decideTriage(facts: TriageFacts): TriageDecision {
  const decided = decide(facts);
  return {
    verdict: decided.verdict,
    actions: actionsFor(decided.verdict),
    citedEvidenceIds: decided.cited,
    reasons: decided.reasons,
    requiresHumanConfirmation: decided.verdict !== 'new_report',
  };
}

export function possibleMatch(evidence: EvidenceRef): boolean {
  return evidence.matchScore !== null && evidence.matchScore < POSSIBLE_MATCH;
}

export function triageCriteria(): { minN: number; possibleMatch: number } {
  return { minN: MIN_N, possibleMatch: POSSIBLE_MATCH };
}
