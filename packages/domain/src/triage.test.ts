import { describe, expect, it } from 'vitest';
import {
  decideTriage,
  possibleMatch,
  triageCriteria,
  type EvidenceRef,
  type TriageFacts,
} from './triage';

const PILOT = '0192f0c4-0000-7000-8000-0000000000a1';
const OTHER = '0192f0c4-0000-7000-8000-0000000000a2';

function facts(overrides: Partial<TriageFacts> = {}): TriageFacts {
  return {
    duplicateCount: 0,
    duplicatesAvailable: true,
    planned: [],
    plannedAvailable: true,
    authority: { institutionId: PILOT, institutionName: 'Dinhub Banyumas' },
    authorityAvailable: true,
    pilotInstitutionId: PILOT,
    serviceRunning: true,
    radarAvailable: true,
    estimate: { level: 'none', direction: 'inconclusive', n: 4 },
    categoryIsService: true,
    connectors: { rup: 'ok', notices: 'ok', authority: 'ok', estimate: 'ok' },
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRef> = {}): EvidenceRef {
  return { id: 'ev-1', tier: 'T1', matchScore: 0.9, ...overrides };
}

describe('decision priority', () => {
  it('prefers merging over every other verdict', () => {
    const decision = decideTriage(
      facts({
        duplicateCount: 2,
        authority: { institutionId: OTHER, institutionName: 'PUPR' },
        planned: [evidence()],
      }),
    );
    expect(decision.verdict).toBe('join');
    expect(decision.reasons[0]).toContain('2 laporan serupa');
  });

  it('prefers wrong authority over a planned package', () => {
    const decision = decideTriage(
      facts({
        authority: { institutionId: OTHER, institutionName: 'PUPR Banyumas' },
        planned: [evidence()],
      }),
    );
    expect(decision.verdict).toBe('wrong_authority');
    expect(decision.reasons[0]).toContain('PUPR Banyumas');
  });

  it('prefers a planned package over the service radar', () => {
    const decision = decideTriage(facts({ planned: [evidence()], serviceRunning: false }));
    expect(decision.verdict).toBe('already_planned');
  });

  it('prefers the radar over an estimate signal', () => {
    const decision = decideTriage(
      facts({
        serviceRunning: false,
        estimate: { level: 'strong', direction: 'excess', n: 40 },
      }),
    );
    expect(decision.verdict).toBe('service_not_running');
  });

  it('prefers data support over insufficient data', () => {
    const decision = decideTriage(
      facts({ estimate: { level: 'indication', direction: 'inconclusive', n: 40 } }),
    );
    expect(decision.verdict).toBe('data_supports');
  });

  it('falls back to a new report when nothing applies', () => {
    const decision = decideTriage(facts({ categoryIsService: false }));
    expect(decision.verdict).toBe('new_report');
    expect(decision.requiresHumanConfirmation).toBe(false);
  });
});

describe('honest degradation', () => {
  it('never claims a duplicate when the connector is down', () => {
    const decision = decideTriage(
      facts({ duplicateCount: 5, duplicatesAvailable: false }),
    );
    expect(decision.verdict).not.toBe('join');
  });

  it('skips authority comparison when no pilot institution is configured', () => {
    const decision = decideTriage(
      facts({
        pilotInstitutionId: null,
        authority: { institutionId: OTHER, institutionName: 'PUPR' },
      }),
    );
    expect(decision.verdict).not.toBe('wrong_authority');
  });

  it('skips authority comparison when the map is unavailable', () => {
    const decision = decideTriage(
      facts({
        authorityAvailable: false,
        authority: { institutionId: OTHER, institutionName: 'PUPR' },
      }),
    );
    expect(decision.verdict).not.toBe('wrong_authority');
  });

  it('ignores planning evidence of tier T3 and T4', () => {
    const decision = decideTriage(
      facts({ planned: [evidence({ tier: 'T3' }), evidence({ tier: 'T4', id: 'ev-2' })] }),
    );
    expect(decision.verdict).not.toBe('already_planned');
  });

  it('ignores the radar when it is not configured', () => {
    const decision = decideTriage(facts({ serviceRunning: false, radarAvailable: false }));
    expect(decision.verdict).not.toBe('service_not_running');
  });

  it('does not use estimate signals for facility complaints', () => {
    const decision = decideTriage(
      facts({
        categoryIsService: false,
        estimate: { level: 'strong', direction: 'excess', n: 40 },
      }),
    );
    expect(decision.verdict).toBe('new_report');
  });
});

describe('data thresholds', () => {
  it('reports insufficient data below the minimum sample', () => {
    const decision = decideTriage(
      facts({ estimate: { level: 'none', direction: 'inconclusive', n: 9 } }),
    );
    expect(decision.verdict).toBe('data_insufficient');
    expect(decision.reasons[0]).toContain(`${triageCriteria().minN}`);
  });

  it('does not claim insufficiency when no estimate exists at all', () => {
    const decision = decideTriage(facts({ estimate: null }));
    expect(decision.verdict).toBe('new_report');
  });

  it('exposes the configured minimum sample and match threshold', () => {
    expect(triageCriteria()).toEqual({ minN: 15, possibleMatch: 0.7 });
  });
});

describe('actions and evidence', () => {
  it('always allows sending the report anyway', () => {
    const verdicts: TriageFacts[] = [
      facts({ duplicateCount: 1 }),
      facts({ authority: { institutionId: OTHER, institutionName: 'PUPR' } }),
      facts({ planned: [evidence()] }),
      facts({ serviceRunning: false }),
      facts({ estimate: { level: 'strong', direction: 'excess', n: 40 } }),
      facts({ estimate: { level: 'none', direction: 'inconclusive', n: 9 } }),
      facts({ categoryIsService: false }),
    ];
    for (const item of verdicts) {
      expect(decideTriage(item).actions.at(-1)).toBe('send_anyway');
    }
  });

  it('cites the strongest planning evidence', () => {
    const decision = decideTriage(
      facts({
        planned: [
          evidence({ id: 'low', tier: 'T2', matchScore: 0.72 }),
          evidence({ id: 'high', tier: 'T1', matchScore: 0.94 }),
        ],
      }),
    );
    expect(decision.citedEvidenceIds).toEqual(['high']);
  });

  it('requires confirmation for every non-trivial verdict', () => {
    expect(decideTriage(facts({ duplicateCount: 1 })).requiresHumanConfirmation).toBe(true);
    expect(decideTriage(facts({ categoryIsService: false })).requiresHumanConfirmation).toBe(
      false,
    );
  });

  it('flags low-confidence matches as possible rather than certain', () => {
    expect(possibleMatch(evidence({ matchScore: 0.4 }))).toBe(true);
    expect(possibleMatch(evidence({ matchScore: 0.7 }))).toBe(false);
    expect(possibleMatch(evidence({ matchScore: null }))).toBe(false);
  });
});
