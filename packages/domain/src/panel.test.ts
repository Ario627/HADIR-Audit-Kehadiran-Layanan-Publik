import { describe, expect, it } from 'vitest';
import {
  PANEL_MIN_QUORUM,
  PANEL_STRONG_QUORUM,
  describePanel,
  eligiblePanelCandidates,
  panelCaveats,
  panelEligibility,
  panelQuorum,
  panelRefusalMessage,
  panelRoleRank,
  panelStrength,
  strongestPanelRole,
  type PanelCandidate,
  type PanelGrant,
} from './panel';

const CLAIMANT = 'institution-dishub';
const CITY = 'city-smg';

function grant(overrides: Partial<PanelGrant> = {}): PanelGrant {
  return {
    id: 'grant-1',
    institutionId: 'institution-polres',
    role: 'verifier',
    status: 'active',
    cityId: CITY,
    createdAt: '2026-10-01T00:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<PanelCandidate> = {}): PanelCandidate {
  return {
    institutionId: 'institution-polres',
    displayName: 'Polrestabes',
    cityId: CITY,
    activeGrant: null,
    ...overrides,
  };
}

describe('panelRoleRank dan strongestPanelRole', () => {
  it('orders observer below verifier', () => {
    expect(panelRoleRank('observer')).toBeLessThan(panelRoleRank('verifier'));
  });

  it('picks the strongest active grant', () => {
    const role = strongestPanelRole([
      grant({ id: 'a', role: 'observer' }),
      grant({ id: 'b', role: 'verifier' }),
    ]);
    expect(role).toBe('verifier');
  });

  it('ignores revoked grants', () => {
    const role = strongestPanelRole([
      grant({ id: 'a', role: 'verifier', revokedAt: '2026-10-02T00:00:00.000Z' }),
      grant({ id: 'b', role: 'observer' }),
    ]);
    expect(role).toBe('observer');
  });

  it('returns null when nothing is active', () => {
    expect(strongestPanelRole([])).toBeNull();
    expect(strongestPanelRole([grant({ status: 'declined' })])).toBeNull();
  });
});

describe('panelEligibility', () => {
  it('refuses the claimant institution', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate({ institutionId: CLAIMANT }),
    });
    expect(result.eligible).toBe(false);
    expect(result.refusal).toBe('self');
  });

  it('refuses a report without a city', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: null,
      candidate: candidate(),
    });
    expect(result.refusal).toBe('unknown_city');
  });

  it('refuses a candidate from another city', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate({ cityId: 'city-jkt' }),
    });
    expect(result.refusal).toBe('different_city');
  });

  it('refuses a candidate with an unknown city', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate({ cityId: null }),
    });
    expect(result.refusal).toBe('different_city');
  });

  it('refuses an institution whose panel access was revoked', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate({
        activeGrant: grant({ status: 'revoked', revokedAt: '2026-10-02T00:00:00.000Z' }),
      }),
    });
    expect(result.refusal).toBe('revoked_recently');
  });

  it('accepts an already active verifier with its existing role', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate({ activeGrant: grant({ role: 'observer' }) }),
    });
    expect(result.eligible).toBe(true);
    expect(result.role).toBe('observer');
  });

  it('offers verifier to an eligible same-city institution', () => {
    const result = panelEligibility({
      claimantInstitutionId: CLAIMANT,
      claimantCityId: CITY,
      candidate: candidate(),
    });
    expect(result.eligible).toBe(true);
    expect(result.role).toBe('verifier');
    expect(result.refusal).toBeNull();
  });
});

describe('panelRefusalMessage', () => {
  it('explains every refusal in Indonesian', () => {
    expect(panelRefusalMessage('self')).toContain('klaim sendiri');
    expect(panelRefusalMessage('different_city')).toContain('Berbeda kota');
    expect(panelRefusalMessage('revoked_recently')).toContain('dicabut');
  });
});

describe('panelQuorum', () => {
  it('needs one active verifier', () => {
    expect(PANEL_MIN_QUORUM).toBe(1);
    expect(panelQuorum(0).met).toBe(false);
    expect(panelQuorum(1).met).toBe(true);
    expect(panelQuorum(0).missing).toBe(1);
  });

  it('never reports negative missing members', () => {
    expect(panelQuorum(5).missing).toBe(0);
  });
});

describe('panelStrength', () => {
  it('is weak without a quorum', () => {
    expect(panelStrength(0, 0)).toBe('weak');
  });

  it('is adequate with one verifier', () => {
    expect(panelStrength(1, 1)).toBe('adequate');
  });

  it('is strong only with two verifiers of two kinds', () => {
    expect(PANEL_STRONG_QUORUM).toBe(2);
    expect(panelStrength(2, 2)).toBe('strong');
    expect(panelStrength(2, 1)).toBe('adequate');
  });
});

describe('eligiblePanelCandidates', () => {
  it('filters out the claimant and other cities', () => {
    const result = eligiblePanelCandidates(CLAIMANT, CITY, [
      candidate({ institutionId: CLAIMANT }),
      candidate({ institutionId: 'other-city', cityId: 'city-jkt' }),
      candidate({ institutionId: 'good' }),
    ]);
    expect(result.map((entry) => entry.institutionId)).toEqual(['good']);
  });

  it('returns nothing when the report has no city', () => {
    expect(eligiblePanelCandidates(CLAIMANT, null, [candidate()])).toEqual([]);
  });
});

describe('describePanel', () => {
  it('summarises members by role', () => {
    const text = describePanel('Dishub', [
      { displayName: 'Polrestabes', role: 'verifier' },
      { displayName: 'Bappeda', role: 'observer' },
    ]);
    expect(text).toContain('1 verifier');
    expect(text).toContain('1 observer');
  });

  it('handles an empty panel', () => {
    expect(describePanel('Dishub', [])).toContain('Belum ada panel');
  });
});

describe('panelCaveats', () => {
  it('states the city boundary and revocation rule', () => {
    const text = panelCaveats().join(' ');
    expect(text).toContain('satu kota');
    expect(text).toContain('tidak kembali otomatis');
    expect(text).toContain('tidak menggantikan konfirmasi warga');
  });
});
