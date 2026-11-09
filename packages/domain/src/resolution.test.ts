import { describe, expect, it } from 'vitest';
import {
  OBSERVATION_SUPPORT_MIN_ROWS,
  acceptsMethodForVerifier,
  checkIndependence,
  decideResolution,
  describeResolution,
  observationSupport,
  resolutionCaveats,
  resolutionCautions,
  resolutionConflicts,
  resolutionMethodLabel,
  type ResolutionClaim,
  type ResolutionVerification,
} from './resolution';

const CLAIM: ResolutionClaim = {
  publicId: 'LPR-2026-000001',
  claimantInstitutionId: 'institution-claimant',
  claimedAt: '2026-10-05T00:00:00.000Z',
};

function verification(
  overrides: Partial<ResolutionVerification> = {},
): ResolutionVerification {
  return {
    id: 'verification-1',
    method: 'field_inspection',
    verdict: 'confirmed',
    verifierKind: 'independent_institution',
    verifierInstitutionId: 'institution-other',
    verifierUserId: null,
    note: null,
    evidenceUrls: ['https://bukti.test/1'],
    verifiedAt: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('resolutionMethodLabel', () => {
  it('labels every method in Indonesian', () => {
    expect(resolutionMethodLabel('citizen_confirmation')).toContain('warga');
    expect(resolutionMethodLabel('field_inspection')).toContain('lapangan');
    expect(resolutionMethodLabel('panel_review')).toContain('panel');
  });
});

describe('checkIndependence', () => {
  it('treats a citizen verifier as independent', () => {
    expect(checkIndependence(CLAIM, 'citizen', null).independent).toBe(true);
  });

  it('treats an automatic verifier as independent', () => {
    expect(checkIndependence(CLAIM, 'automatic', null).independent).toBe(true);
  });

  it('treats the claimant institution as not independent', () => {
    const check = checkIndependence(CLAIM, 'independent_institution', 'institution-claimant');
    expect(check.independent).toBe(false);
    expect(check.reason).toContain('tidak boleh memverifikasi');
  });

  it('treats a different institution as independent', () => {
    expect(
      checkIndependence(CLAIM, 'independent_institution', 'institution-other').independent,
    ).toBe(true);
  });

  it('rejects an institution verifier with no identity', () => {
    const check = checkIndependence(CLAIM, 'independent_institution', null);
    expect(check.independent).toBe(false);
    expect(check.reason).toContain('wajib mencantumkan identitas');
  });

  it('treats the platform as independent', () => {
    expect(checkIndependence(CLAIM, 'platform', null).independent).toBe(true);
  });
});

describe('acceptsMethodForVerifier', () => {
  it('allows a citizen only citizen confirmation', () => {
    expect(acceptsMethodForVerifier('citizen_confirmation', 'citizen')).toBe(true);
    expect(acceptsMethodForVerifier('field_inspection', 'citizen')).toBe(false);
  });

  it('allows automatic only observation data', () => {
    expect(acceptsMethodForVerifier('observation_data', 'automatic')).toBe(true);
    expect(acceptsMethodForVerifier('panel_review', 'automatic')).toBe(false);
  });

  it('allows an institution field inspection or panel review', () => {
    expect(acceptsMethodForVerifier('field_inspection', 'independent_institution')).toBe(true);
    expect(acceptsMethodForVerifier('panel_review', 'independent_institution')).toBe(true);
    expect(acceptsMethodForVerifier('citizen_confirmation', 'independent_institution')).toBe(
      false,
    );
  });

  it('allows the platform panel review or field inspection', () => {
    expect(acceptsMethodForVerifier('panel_review', 'platform')).toBe(true);
    expect(acceptsMethodForVerifier('observation_data', 'platform')).toBe(false);
  });
});

describe('decideResolution', () => {
  it('keeps the claim unverified when nothing independent exists', () => {
    const decision = decideResolution(CLAIM, []);
    expect(decision.status).toBe('claimed_resolved');
    expect(decision.outcome).toBe('undecided');
    expect(decision.reason).toContain('Belum ada verifikasi');
  });

  it('verifies when one independent confirmation exists', () => {
    const decision = decideResolution(CLAIM, [verification()]);
    expect(decision.status).toBe('verified_resolved');
    expect(decision.supporting).toBe(1);
  });

  it('reopens the case when any independent refutation exists', () => {
    const decision = decideResolution(CLAIM, [
      verification({ id: 'a', verdict: 'confirmed' }),
      verification({ id: 'b', verdict: 'refuted', evidenceUrls: [] }),
    ]);
    expect(decision.status).toBe('disputed');
    expect(decision.refuting).toBe(1);
  });

  it('does not let a single refutation be outvoted by confirmations', () => {
    const decision = decideResolution(CLAIM, [
      verification({ id: 'a', verdict: 'confirmed' }),
      verification({ id: 'b', verdict: 'confirmed' }),
      verification({ id: 'c', verdict: 'confirmed' }),
      verification({ id: 'd', verdict: 'refuted', evidenceUrls: [] }),
    ]);
    expect(decision.status).toBe('disputed');
  });

  it('ignores a self verification entirely', () => {
    const decision = decideResolution(CLAIM, [
      verification({
        verdict: 'confirmed',
        verifierInstitutionId: 'institution-claimant',
      }),
    ]);
    expect(decision.status).toBe('claimed_resolved');
    expect(decision.supporting).toBe(0);
  });

  it('stays undecided when only inconclusive verifications exist', () => {
    const decision = decideResolution(CLAIM, [
      verification({ verdict: 'inconclusive', evidenceUrls: [] }),
    ]);
    expect(decision.status).toBe('claimed_resolved');
    expect(decision.inconclusive).toBe(1);
    expect(decision.reason).toContain('belum menyimpulkan');
  });

  it('counts a citizen confirmation as independent evidence', () => {
    const decision = decideResolution(CLAIM, [
      verification({
        method: 'citizen_confirmation',
        verifierKind: 'citizen',
        verifierInstitutionId: null,
        verifierUserId: 'user-1',
      }),
    ]);
    expect(decision.status).toBe('verified_resolved');
  });
});

describe('observationSupport', () => {
  it('refuses to conclude below the minimum row count', () => {
    const support = observationSupport(
      { rows: OBSERVATION_SUPPORT_MIN_ROWS - 1, excessShare: 0.01, windowStart: 'a', windowEnd: 'b' },
      0.2,
    );
    expect(support.supporting).toBe(false);
    expect(support.message).toContain('belum cukup');
  });

  it('supports when the excess share is under the threshold', () => {
    const support = observationSupport(
      { rows: 100, excessShare: 0.1, windowStart: 'a', windowEnd: 'b' },
      0.2,
    );
    expect(support.supporting).toBe(true);
    expect(support.message).toContain('mendukung');
  });

  it('does not support when the excess share still exceeds the threshold', () => {
    const support = observationSupport(
      { rows: 100, excessShare: 0.5, windowStart: 'a', windowEnd: 'b' },
      0.2,
    );
    expect(support.supporting).toBe(false);
    expect(support.message).toContain('belum mendukung');
  });
});

describe('resolutionConflicts', () => {
  it('accepts a clean single independent inspection', () => {
    expect(resolutionConflicts(CLAIM, [verification()])).toEqual([]);
  });

  it('flags self verification', () => {
    const conflicts = resolutionConflicts(CLAIM, [
      verification({ verifierInstitutionId: 'institution-claimant' }),
    ]);
    expect(conflicts.map((conflict) => conflict.code)).toContain('self_verification');
  });

  it('flags a method that does not match the verifier kind', () => {
    const conflicts = resolutionConflicts(CLAIM, [
      verification({ method: 'citizen_confirmation', verifierKind: 'independent_institution' }),
    ]);
    expect(conflicts.map((conflict) => conflict.code)).toContain('method_mismatch');
  });

  it('flags the same institution verifying twice', () => {
    const conflicts = resolutionConflicts(CLAIM, [
      verification({ id: 'a' }),
      verification({ id: 'b' }),
    ]);
    expect(conflicts.map((conflict) => conflict.code)).toContain('duplicate_verifier');
  });

  it('flags a confirmation without evidence links', () => {
    const conflicts = resolutionConflicts(CLAIM, [verification({ evidenceUrls: [] })]);
    expect(conflicts.map((conflict) => conflict.code)).toContain(
      'confirmation_without_evidence',
    );
  });

  it('treats a single inspected confirmation as valid, not as a conflict', () => {
    expect(resolutionConflicts(CLAIM, [verification()])).toEqual([]);
  });
});

describe('resolutionCautions', () => {
  it('notes when evidence rests on a single verification', () => {
    const cautions = resolutionCautions(CLAIM, [verification()]);
    expect(cautions.join(' ')).toContain('satu verifikasi independen');
  });

  it('notes when all verifications come from institutions only', () => {
    const cautions = resolutionCautions(CLAIM, [
      verification({ id: 'a', verifierInstitutionId: 'institution-a' }),
      verification({ id: 'b', verifierInstitutionId: 'institution-b' }),
    ]);
    expect(cautions.join(' ')).toContain('tanpa konfirmasi warga');
  });

  it('notes a reused evidence link', () => {
    const cautions = resolutionCautions(CLAIM, [
      verification({ id: 'a' }),
      verification({ id: 'b', verifierInstitutionId: 'institution-b' }),
    ]);
    expect(cautions.join(' ')).toContain('dipakai lebih dari satu kali');
  });

  it('stays quiet for corroborated evidence from mixed sources', () => {
    const cautions = resolutionCautions(CLAIM, [
      verification({ id: 'a', evidenceUrls: ['https://bukti.test/a'] }),
      verification({
        id: 'b',
        method: 'citizen_confirmation',
        verifierKind: 'citizen',
        verifierInstitutionId: null,
        verifierUserId: 'user-9',
        evidenceUrls: ['https://bukti.test/b'],
      }),
    ]);
    expect(cautions.join(' ')).not.toContain('satu verifikasi independen');
  });
});

describe('describeResolution', () => {
  it('describes each outcome', () => {
    const verified = decideResolution(CLAIM, [verification()]);
    expect(describeResolution(verified)).toContain('terverifikasi');
    const disputed = decideResolution(CLAIM, [verification({ verdict: 'refuted' })]);
    expect(describeResolution(disputed)).toContain('dibantah');
    const undecided = decideResolution(CLAIM, []);
    expect(describeResolution(undecided)).toContain('Belum terbukti');
  });
});

describe('resolutionCaveats', () => {
  it('states that data supports but never decides', () => {
    const text = resolutionCaveats().join(' ');
    expect(text).toContain('tidak pernah memutuskan sendiri');
    expect(text).toContain('tidak pernah boleh memverifikasi klaimnya sendiri');
  });
});
