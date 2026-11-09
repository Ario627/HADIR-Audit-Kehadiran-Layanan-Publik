import { describe, expect, it } from 'vitest';
import {
  assessFieldVerification,
  describeVerification,
  isIndependentVerification,
  verificationMethodAllowed,
  verificationRequirements,
  type FieldVerificationRecord,
  type VerificationContext,
} from './verification.ts';

const PUBLIC_ID = 'LPR-2026-000123';

function record(overrides: Partial<FieldVerificationRecord> = {}): FieldVerificationRecord {
  return {
    reportPublicId: PUBLIC_ID,
    verifierRole: 'moderator',
    verifierId: '0192f0c4-0000-7000-8000-0000000000d2',
    method: 'field_visit',
    verifiedAt: '2026-10-20T10:00:00.000Z',
    evidenceIds: ['0192f0c4-0000-7000-8000-0000000000e1', '0192f0c4-0000-7000-8000-0000000000e2'],
    note: 'Kunjungan lapangan pada pagi hari, halte bersih dan bus datang dua kali.',
    independentOfOperator: true,
    ...overrides,
  };
}

function context(overrides: Partial<VerificationContext> = {}): VerificationContext {
  return {
    reportCreatedAt: '2026-10-18T08:00:00.000Z',
    now: '2026-10-25T08:00:00.000Z',
    operatorInstitutionId: '0192f0c4-0000-7000-8000-0000000000a1',
    verifierInstitutionId: null,
    knownEvidenceIds: [
      '0192f0c4-0000-7000-8000-0000000000e1',
      '0192f0c4-0000-7000-8000-0000000000e2',
    ],
    ...overrides,
  };
}

describe('verificationMethodAllowed', () => {
  it('lets a moderator run field visits but not act as the operator', () => {
    expect(verificationMethodAllowed('moderator', 'field_visit')).toBe(true);
    expect(verificationMethodAllowed('moderator', 'operator_report')).toBe(false);
  });

  it('restricts a partner to operator reports and remote reviews', () => {
    expect(verificationMethodAllowed('partner', 'operator_report')).toBe(true);
    expect(verificationMethodAllowed('partner', 'remote_review')).toBe(true);
    expect(verificationMethodAllowed('partner', 'field_visit')).toBe(false);
  });

  it('lets an auditor run field and third party audits only', () => {
    expect(verificationMethodAllowed('auditor', 'field_visit')).toBe(true);
    expect(verificationMethodAllowed('auditor', 'third_party_audit')).toBe(true);
    expect(verificationMethodAllowed('auditor', 'operator_report')).toBe(false);
  });
});

describe('isIndependentVerification', () => {
  it('accepts a field visit by an unrelated verifier', () => {
    expect(isIndependentVerification(record(), context())).toBe(true);
  });

  it('rejects a verification from the operator institution itself', () => {
    const sameInstitution = context({
      verifierInstitutionId: '0192f0c4-0000-7000-8000-0000000000a1',
    });
    expect(isIndependentVerification(record(), sameInstitution)).toBe(false);
  });

  it('rejects an operator report even when the flag says independent', () => {
    expect(isIndependentVerification(record({ method: 'operator_report' }), context())).toBe(
      false,
    );
  });

  it('rejects an explicitly non independent record', () => {
    expect(
      isIndependentVerification(record({ independentOfOperator: false }), context()),
    ).toBe(false);
  });
});

describe('assessFieldVerification', () => {
  it('accepts a complete, independent, evidenced verification', () => {
    const result = assessFieldVerification(record(), context());
    expect(result.accepted).toBe(true);
    expect(result.level).toBe('field_verified');
    expect(result.checks.every((check) => check.ok)).toBe(true);
  });

  it('refuses to grant the level without evidence', () => {
    const result = assessFieldVerification(record({ evidenceIds: [] }), context());
    expect(result.accepted).toBe(false);
    expect(result.level).toBe('none');
    expect(result.checks.find((check) => check.code === 'evidence_attached')?.ok).toBe(false);
  });

  it('rejects evidence the system does not know', () => {
    const result = assessFieldVerification(
      record({ evidenceIds: ['0192f0c4-0000-7000-8000-0000000000ff'] }),
      context(),
    );
    expect(result.accepted).toBe(false);
  });

  it('rejects a note that does not explain the judgement', () => {
    const result = assessFieldVerification(record({ note: 'ok' }), context());
    expect(result.accepted).toBe(false);
    expect(result.checks.find((check) => check.code === 'note_substantive')?.ok).toBe(false);
  });

  it('rejects a verification dated before the report existed', () => {
    const result = assessFieldVerification(
      record({ verifiedAt: '2026-10-01T10:00:00.000Z' }),
      context(),
    );
    expect(result.accepted).toBe(false);
    expect(result.checks.find((check) => check.code === 'time_window_valid')?.ok).toBe(false);
  });

  it('rejects a verification dated into the future', () => {
    const result = assessFieldVerification(
      record({ verifiedAt: '2026-12-01T10:00:00.000Z' }),
      context(),
    );
    expect(result.accepted).toBe(false);
  });

  it('tolerates a small clock skew around the creation time', () => {
    const result = assessFieldVerification(
      record({ verifiedAt: '2026-10-18T07:58:00.000Z' }),
      context(),
    );
    expect(result.checks.find((check) => check.code === 'time_window_valid')?.ok).toBe(true);
  });

  it('rejects self verification by the operator', () => {
    const result = assessFieldVerification(
      record({ method: 'operator_report', independentOfOperator: false }),
      context(),
    );
    expect(result.accepted).toBe(false);
    expect(result.warnings).toContain('self_verification_rejected');
    expect(result.checks.find((check) => check.code === 'independent_of_operator')?.ok).toBe(
      false,
    );
  });

  it('rejects a partner claiming a field visit they are not allowed to perform', () => {
    const result = assessFieldVerification(
      record({ verifierRole: 'partner', method: 'field_visit' }),
      context(),
    );
    expect(result.accepted).toBe(false);
    expect(result.checks.find((check) => check.code === 'method_allowed_for_role')?.ok).toBe(
      false,
    );
  });

  it('warns when only one evidence item backs the verification', () => {
    const result = assessFieldVerification(
      record({ evidenceIds: ['0192f0c4-0000-7000-8000-0000000000e1'] }),
      context(),
    );
    expect(result.accepted).toBe(true);
    expect(result.warnings).toContain('single_evidence_item');
  });

  it('rejects an unrecognised report id', () => {
    const result = assessFieldVerification(record({ reportPublicId: 'X' }), context());
    expect(result.accepted).toBe(false);
  });
});

describe('verification documentation', () => {
  it('explains the outcome in one readable sentence', () => {
    const rejected = describeVerification(
      assessFieldVerification(record({ note: 'ok' }), context()),
    );
    expect(rejected).toContain('ditolak');
    const accepted = describeVerification(assessFieldVerification(record(), context()));
    expect(accepted).toContain('diterima');
  });

  it('publishes the operational requirements', () => {
    const requirements = verificationRequirements();
    expect(requirements.length).toBeGreaterThanOrEqual(5);
    expect(requirements.join(' ')).toContain('tidak boleh berasal dari pihak yang mengklaim');
  });
});
