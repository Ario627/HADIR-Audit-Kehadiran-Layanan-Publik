import { describe, expect, it } from 'vitest';
import {
  RETENTION_POLICY,
  actionableDecisions,
  applyOverrides,
  decisionFor,
  describeRetention,
  immutableDatasets,
  isImmutableDataset,
  planRetention,
  policyViolations,
  protectedDatasets,
  ruleFor,
  type RetentionDataset,
} from './retention';

const NOW = '2026-11-09T00:00:00.000Z';

describe('RETENTION_POLICY integrity', () => {
  it('has no structural violations', () => {
    expect(policyViolations()).toEqual([]);
  });

  it('never schedules deletion for integrity datasets', () => {
    for (const dataset of ['report_events', 'audit_log', 'anchor_log'] as const) {
      expect(ruleFor(dataset)?.action).toBe('keep');
      expect(isImmutableDataset(dataset)).toBe(true);
    }
  });

  it('lists every immutable dataset', () => {
    expect(immutableDatasets()).toEqual(['report_events', 'audit_log', 'anchor_log']);
  });

  it('protects reports and attached media from automatic deletion', () => {
    const protectedList = protectedDatasets();
    expect(protectedList).toContain('reports');
    expect(protectedList).toContain('uploads.attached');
  });

  it('gives every actionable rule a legal basis and a rationale', () => {
    for (const entry of RETENTION_POLICY.rules) {
      expect(entry.legalBasis.length).toBeGreaterThan(0);
      expect(entry.rationale.length).toBeGreaterThanOrEqual(20);
    }
  });

  it('keeps every floor at or below its retention window', () => {
    for (const entry of RETENTION_POLICY.rules) {
      if (entry.action === 'keep' || entry.retentionDays === null || entry.floorDays === null) {
        continue;
      }
      expect(entry.floorDays).toBeLessThanOrEqual(entry.retentionDays);
    }
  });

  it('detects an injected duplicate rule', () => {
    const tampered = {
      ...RETENTION_POLICY,
      rules: [...RETENTION_POLICY.rules, RETENTION_POLICY.rules[0]!],
    };
    expect(policyViolations(tampered)).toContain(
      `duplicate_rule:${RETENTION_POLICY.rules[0]!.dataset}`,
    );
  });

  it('detects a policy that would delete the audit log', () => {
    const tampered = {
      ...RETENTION_POLICY,
      rules: RETENTION_POLICY.rules.map((entry) =>
        entry.dataset === 'audit_log'
          ? { ...entry, action: 'delete' as const, retentionDays: 30 }
          : entry,
      ),
    };
    expect(policyViolations(tampered)).toContain('integrity_dataset_not_kept:audit_log');
  });

  it('detects a keep rule that still carries a retention window', () => {
    const tampered = {
      ...RETENTION_POLICY,
      rules: RETENTION_POLICY.rules.map((entry) =>
        entry.dataset === 'reports' ? { ...entry, retentionDays: 30 } : entry,
      ),
    };
    expect(policyViolations(tampered)).toContain('keep_with_retention:reports');
  });
});

describe('planRetention', () => {
  const plan = planRetention({ now: NOW });

  it('computes a cutoff for every actionable rule', () => {
    for (const decision of actionableDecisions(plan)) {
      expect(decision.cutoff).not.toBeNull();
      expect(new Date(decision.cutoff!).getTime()).toBeLessThan(new Date(NOW).getTime());
    }
  });

  it('leaves protected datasets without a cutoff', () => {
    for (const dataset of protectedDatasets()) {
      const decision = decisionFor(plan, dataset);
      expect(decision?.cutoff).toBeNull();
      expect(decision?.action).toBe('keep');
    }
  });

  it('places the uploads cutoff two days back', () => {
    const decision = decisionFor(plan, 'uploads.pending')!;
    expect(decision.effectiveDays).toBe(2);
    expect(decision.cutoff).toBe('2026-11-07T00:00:00.000Z');
  });

  it('marks contact email as anonymize rather than delete', () => {
    const decision = decisionFor(plan, 'reports.contact_email')!;
    expect(decision.action).toBe('anonymize');
    expect(decision.effectiveDays).toBe(90);
  });

  it('skips actionable datasets from the skipped list only when protected', () => {
    expect(plan.skipped).toContain('reports');
    expect(plan.skipped).toContain('audit_log');
    expect(plan.skipped).not.toContain('uploads.pending');
  });

  it('returns an empty plan for an unparsable now', () => {
    const broken = planRetention({ now: 'kemarin' });
    expect(broken.decisions).toEqual([]);
    expect(broken.skipped).toContain('invalid_now');
    expect(broken.warnings).toContain('now_invalid');
  });

  it('is deterministic for the same input', () => {
    expect(planRetention({ now: NOW })).toEqual(planRetention({ now: NOW }));
  });
});

describe('overrides', () => {
  it('applies a valid longer retention within the cap', () => {
    const plan = planRetention({
      now: NOW,
      overrides: [{ dataset: 'uploads.pending', retentionDays: 4 }],
    });
    const decision = decisionFor(plan, 'uploads.pending')!;
    expect(decision.effectiveDays).toBe(4);
    expect(decision.overridden).toBe(true);
    expect(decision.rejectedOverride).toBeNull();
  });

  it('clamps an override below the floor and records why', () => {
    const plan = planRetention({
      now: NOW,
      overrides: [{ dataset: 'idempotency_keys', retentionDays: 1 }],
    });
    const decision = decisionFor(plan, 'idempotency_keys')!;
    expect(decision.effectiveDays).toBe(7);
    expect(decision.overridden).toBe(false);
    expect(decision.rejectedOverride).toContain('di bawah lantai');
    expect(plan.warnings).toContain('override_below_floor:idempotency_keys');
  });

  it('clamps an override above the hard cap', () => {
    const plan = planRetention({
      now: NOW,
      overrides: [{ dataset: 'exports.file', retentionDays: 400 }],
    });
    const decision = decisionFor(plan, 'exports.file')!;
    expect(decision.effectiveDays).toBe(8);
    expect(plan.warnings).toContain('override_above_cap:exports.file');
  });

  it('refuses to shorten or delete a protected dataset', () => {
    const plan = planRetention({
      now: NOW,
      overrides: [{ dataset: 'audit_log', retentionDays: 10 }],
    });
    const decision = decisionFor(plan, 'audit_log')!;
    expect(decision.action).toBe('keep');
    expect(plan.warnings).toContain('override_protected_dataset:audit_log');
  });

  it('rejects an override for an unknown dataset', () => {
    const result = applyOverrides([
      { dataset: 'mystery_table' as RetentionDataset, retentionDays: 5 },
    ]);
    expect(result.warnings).toContain('override_unknown_dataset:mystery_table');
    expect(result.decisions.size).toBe(0);
  });

  it('lets multiple overrides apply independently', () => {
    const plan = planRetention({
      now: NOW,
      overrides: [
        { dataset: 'uploads.pending', retentionDays: 3 },
        { dataset: 'export.file' as RetentionDataset, retentionDays: 3 },
      ],
    });
    expect(decisionFor(plan, 'uploads.pending')?.effectiveDays).toBe(3);
    expect(plan.warnings).toContain('override_unknown_dataset:export.file');
  });
});

describe('describeRetention', () => {
  it('produces one line per decision in plain language', () => {
    const lines = describeRetention(planRetention({ now: NOW }));
    expect(lines.length).toBe(RETENTION_POLICY.rules.length);
    expect(lines.some((line) => line.includes('disimpan permanen'))).toBe(true);
    expect(lines.some((line) => line.includes('lebih tua dari'))).toBe(true);
  });
});

describe('actionableDecisions', () => {
  it('excludes keep rules and anything without a cutoff', () => {
    const plan = planRetention({ now: NOW });
    for (const decision of actionableDecisions(plan)) {
      expect(decision.action).not.toBe('keep');
      expect(decision.cutoff).not.toBeNull();
    }
  });
});
