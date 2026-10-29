export type EvidenceLevel = 'none' | 'indication' | 'strong' | 'field_verified';
export type Direction = 'excess' | 'no_excess' | 'inconclusive';

export interface EvidenceInput {
  n: number;
  days: number;
  devices: number;
  clusters: number;
  ciLow: number | null;
  threshold: number | null;
  fieldVerified?: boolean;
}

export interface DirectionInput {
  n: number;
  clusters: number;
  ciLow: number | null;
  ciHigh: number | null;
  threshold: number | null;
}

export interface EvidenceView {
  evidence: EvidenceLevel;
  direction: Direction;
}

export function evidenceLevel(input: EvidenceInput): EvidenceLevel {
  if (input.n < 15 || input.clusters < 3) {
    return 'none';
  }
  if (input.threshold === null || input.ciLow === null) {
    return 'indication';
  }
  const strong =
    input.n >= 30 &&
    input.days >= 3 &&
    input.devices >= 10 &&
    input.clusters >= 10 &&
    input.ciLow > input.threshold;
  if (input.fieldVerified === true && strong) {
    return 'field_verified';
  }
  return strong ? 'strong' : 'indication';
}

export function directionFor(input: DirectionInput): Direction {
  if (input.n < 15 || input.clusters < 3) {
    return 'inconclusive';
  }
  if (input.threshold === null || input.ciLow === null || input.ciHigh === null) {
    return 'inconclusive';
  }
  if (input.ciLow > input.threshold) {
    return 'excess';
  }
  if (input.ciHigh < input.threshold) {
    return 'no_excess';
  }
  return 'inconclusive';
}

export function evidenceView(input: EvidenceInput & { ciHigh: number | null }): EvidenceView {
  const direction = directionFor({
    n: input.n,
    clusters: input.clusters,
    ciLow: input.ciLow,
    ciHigh: input.ciHigh,
    threshold: input.threshold,
  });
  const raw = evidenceLevel(input);
  return { evidence: direction === 'no_excess' ? 'none' : raw, direction };
}