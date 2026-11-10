import { describe, expect, it } from 'vitest';
import {
  MIN_APPEALS_FOR_FAIRNESS,
  MIN_REPORTS_FOR_PUBLICATION,
  MIN_SLA_FOR_PUBLICATION,
  describeScorecard,
  rankInstitutions,
  scorecardCaveats,
  scorecardFor,
  scorecardState,
  type InstitutionRanking,
  type ScorecardInput,
} from './scorecard';

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    reportsReceived: 80,
    reportsAcknowledged: 72,
    reportsResponded: 60,
    slaTracked: 40,
    slaMet: 30,
    claimsResolved: 20,
    claimsVerified: 15,
    claimsDisputed: 2,
    appealsDecided: 10,
    appealsOverturned: 2,
    windowDays: 90,
    ...overrides,
  };
}

describe('scorecardState', () => {
  it('is insufficient below the report gate', () => {
    expect(scorecardState(input({ reportsReceived: MIN_REPORTS_FOR_PUBLICATION - 1 }))).toBe(
      'insufficient',
    );
  });

  it('is provisional below the SLA gate', () => {
    expect(scorecardState(input({ slaTracked: MIN_SLA_FOR_PUBLICATION - 1 }))).toBe(
      'provisional',
    );
  });

  it('is published once both gates clear', () => {
    expect(scorecardState(input())).toBe('published');
  });
});

describe('scorecardFor', () => {
  it('hides the overall score entirely when the sample is too small', () => {
    const card = scorecardFor(input({ reportsReceived: 3 }));
    expect(card.state).toBe('insufficient');
    expect(card.overall).toBeNull();
    expect(card.summary).toContain('Tidak ada angka yang dipublikasikan');
  });

  it('computes the four process dimensions as ratios', () => {
    const card = scorecardFor(input());
    const byKey = Object.fromEntries(card.dimensions.map((entry) => [entry.dimension, entry]));
    expect(byKey.responsiveness?.value).toBe(0.9);
    expect(byKey.timeliness?.value).toBe(0.75);
    expect(byKey.resolutionIntegrity?.value).toBe(0.75);
    expect(byKey.appealFairness?.value).toBe(0.8);
  });

  it('returns null for a dimension with no denominator', () => {
    const card = scorecardFor(input({ claimsResolved: 0, claimsVerified: 0 }));
    const integrity = card.dimensions.find((entry) => entry.dimension === 'resolutionIntegrity');
    expect(integrity?.value).toBeNull();
  });

  it('averages only the dimensions that have data', () => {
    const card = scorecardFor(
      input({ claimsResolved: 0, claimsVerified: 0, appealsDecided: 0, appealsOverturned: 0 }),
    );
    expect(card.overall).toBeCloseTo((0.9 + 0.75) / 2, 3);
  });

  it('never returns an overall score of null for a published card with data', () => {
    const card = scorecardFor(input());
    expect(card.overall).not.toBeNull();
    expect(card.overall).toBeGreaterThan(0);
    expect(card.overall).toBeLessThanOrEqual(1);
  });

  it('warns when the appeal sample is too small', () => {
    const card = scorecardFor(input({ appealsDecided: 1, appealsOverturned: 0 }));
    expect(card.warnings.join(' ')).toContain('keadilan banding belum dapat dinilai');
  });

  it('counts disputes as integrity failures, not delays', () => {
    const card = scorecardFor(input({ claimsDisputed: 5 }));
    expect(card.warnings.join(' ')).toContain('kegagalan integritas');
  });

  it('produces a provisional summary without pretending it is final', () => {
    const card = scorecardFor(input({ slaTracked: 4 }));
    expect(card.state).toBe('provisional');
    expect(card.summary).toContain('sementara');
  });

  it('clamps ratios when input exceeds the denominator', () => {
    const card = scorecardFor(input({ reportsAcknowledged: 200 }));
    const responsiveness = card.dimensions.find(
      (entry) => entry.dimension === 'responsiveness',
    );
    expect(responsiveness?.value).toBe(1);
  });

  it('refuses to divide by zero received reports without throwing', () => {
    const card = scorecardFor(input({ reportsReceived: 0, reportsAcknowledged: 0 }));
    const responsiveness = card.dimensions.find(
      (entry) => entry.dimension === 'responsiveness',
    );
    expect(responsiveness?.value).toBeNull();
    expect(card.state).toBe('insufficient');
  });
});

describe('rankInstitutions', () => {
  const base: InstitutionRanking = {
    institutionId: 'a',
    name: 'Dishub',
    scorecard: scorecardFor(input()),
    rank: null,
  };

  it('ranks only published scorecards', () => {
    const ranked = rankInstitutions([
      base,
      {
        institutionId: 'b',
        name: 'Kecil',
        scorecard: scorecardFor(input({ reportsReceived: 2 })),
        rank: null,
      },
    ]);
    expect(ranked.find((entry) => entry.institutionId === 'a')?.rank).toBe(1);
    expect(ranked.find((entry) => entry.institutionId === 'b')?.rank).toBeNull();
  });

  it('orders by overall score descending', () => {
    const ranked = rankInstitutions([
      { ...base, institutionId: 'low', scorecard: scorecardFor(input({ slaMet: 5 })) },
      { ...base, institutionId: 'high' },
    ]);
    expect(ranked.find((entry) => entry.institutionId === 'high')?.rank).toBe(1);
    expect(ranked.find((entry) => entry.institutionId === 'low')?.rank).toBe(2);
  });

  it('excludes provisional scorecards from the ranking', () => {
    const ranked = rankInstitutions([
      { ...base, institutionId: 'p', scorecard: scorecardFor(input({ slaTracked: 1 })) },
    ]);
    expect(ranked[0]?.rank).toBeNull();
  });
});

describe('describeScorecard', () => {
  it('names the weakest dimension for a published card', () => {
    const card = scorecardFor(input({ slaMet: 4 }));
    const text = describeScorecard(card);
    expect(text).toContain('terlemah');
  });

  it('says data is missing for an insufficient card', () => {
    expect(describeScorecard(scorecardFor(input({ reportsReceived: 1 })))).toContain(
      'Belum cukup data',
    );
  });
});

describe('scorecardCaveats', () => {
  it('separates process measurement from citizen satisfaction', () => {
    const text = scorecardCaveats().join(' ');
    expect(text).toContain('bukan kepuasan warga');
    expect(text).toContain('tidak diberi peringkat');
    expect(text).toContain('kota yang berbeda beban laporan');
  });

  it('exposes the fairness gate', () => {
    expect(MIN_APPEALS_FOR_FAIRNESS).toBeGreaterThan(0);
  });
});
