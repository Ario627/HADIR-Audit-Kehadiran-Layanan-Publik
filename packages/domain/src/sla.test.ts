import { describe, expect, it } from 'vitest';
import {
  SLA_POLICY_VERSION,
  describeSlaPhase,
  priorityRank,
  raisePriority,
  slaBreaches,
  slaCaveats,
  slaDeadlines,
  slaEscalationLine,
  slaPolicyEntry,
  slaPriorityFor,
  slaReport,
  slaTargetsFor,
  type SlaMilestones,
} from './sla';

const SUBMITTED = '2026-10-01T00:00:00.000Z';

function milestones(overrides: Partial<SlaMilestones> = {}): SlaMilestones {
  return {
    submittedAt: SUBMITTED,
    acknowledgedAt: null,
    respondedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

describe('priorityRank dan raisePriority', () => {
  it('orders priorities from low to critical', () => {
    expect(priorityRank('low')).toBeLessThan(priorityRank('normal'));
    expect(priorityRank('normal')).toBeLessThan(priorityRank('high'));
    expect(priorityRank('high')).toBeLessThan(priorityRank('critical'));
  });

  it('raises priority by steps without exceeding critical', () => {
    expect(raisePriority('low', 1)).toBe('normal');
    expect(raisePriority('high', 1)).toBe('critical');
    expect(raisePriority('critical', 5)).toBe('critical');
  });

  it('lowers bounded at low', () => {
    expect(raisePriority('low', -3)).toBe('low');
  });
});

describe('slaPriorityFor', () => {
  it('treats stop safety as critical', () => {
    expect(slaPriorityFor('stop_safety', 'none')).toBe('critical');
  });

  it('treats no show and accessibility as high', () => {
    expect(slaPriorityFor('service_no_show', 'none')).toBe('high');
    expect(slaPriorityFor('accessibility', 'none')).toBe('high');
  });

  it('raises priority when evidence is strong', () => {
    expect(slaPriorityFor('service_wait', 'indication')).toBe('normal');
    expect(slaPriorityFor('service_wait', 'strong')).toBe('high');
    expect(slaPriorityFor('service_wait', 'field_verified')).toBe('high');
  });

  it('keeps safety at least high even at the weakest evidence', () => {
    expect(priorityRank(slaPriorityFor('stop_safety', 'none'))).toBeGreaterThanOrEqual(
      priorityRank('high'),
    );
  });

  it('treats route information as low', () => {
    expect(slaPriorityFor('route_info', 'none')).toBe('low');
  });
});

describe('slaTargetsFor', () => {
  it('tightens every phase as priority rises', () => {
    const low = slaTargetsFor('low');
    const critical = slaTargetsFor('critical');
    expect(critical.acknowledgeHours).toBeLessThan(low.acknowledgeHours);
    expect(critical.respondHours).toBeLessThan(low.respondHours);
    expect(critical.resolveHours).toBeLessThan(low.resolveHours);
  });

  it('keeps the order acknowledge < respond < resolve', () => {
    for (const priority of ['low', 'normal', 'high', 'critical'] as const) {
      const targets = slaTargetsFor(priority);
      expect(targets.acknowledgeHours).toBeLessThan(targets.respondHours);
      expect(targets.respondHours).toBeLessThan(targets.resolveHours);
    }
  });

  it('builds a full policy entry', () => {
    const entry = slaPolicyEntry('stop_safety', 'strong');
    expect(entry.category).toBe('stop_safety');
    expect(entry.priority).toBe('critical');
    expect(entry.resolveHours).toBe(slaTargetsFor('critical').resolveHours);
  });
});

describe('slaDeadlines', () => {
  it('adds the target hours to the submission time', () => {
    const deadlines = slaDeadlines(SUBMITTED, {
      acknowledgeHours: 2,
      respondHours: 8,
      resolveHours: 24,
    });
    expect(deadlines.acknowledge).toBe('2026-10-01T02:00:00.000Z');
    expect(deadlines.respond).toBe('2026-10-01T08:00:00.000Z');
    expect(deadlines.resolve).toBe('2026-10-02T00:00:00.000Z');
  });

  it('rejects an invalid base time', () => {
    expect(() =>
      slaDeadlines('bukan-tanggal', { acknowledgeHours: 1, respondHours: 2, resolveHours: 3 }),
    ).toThrow(/SLA/u);
  });
});

describe('slaReport', () => {
  it('marks every phase pending while inside the window', () => {
    const report = slaReport(milestones(), 'normal', '2026-10-01T01:00:00.000Z');
    expect(report.phases.every((phase) => phase.state === 'pending')).toBe(true);
    expect(report.breached).toBe(false);
    expect(report.escalation).toBe(0);
  });

  it('marks a phase met when the milestone lands before the deadline', () => {
    const report = slaReport(
      milestones({ acknowledgedAt: '2026-10-01T10:00:00.000Z' }),
      'normal',
      '2026-10-01T12:00:00.000Z',
    );
    const acknowledge = report.phases.find((phase) => phase.phase === 'acknowledge');
    expect(acknowledge?.state).toBe('met');
    expect(acknowledge?.lateByHours).toBeNull();
  });

  it('marks a phase met_late with the lateness in hours', () => {
    const report = slaReport(
      milestones({ acknowledgedAt: '2026-10-02T06:00:00.000Z' }),
      'normal',
      '2026-10-02T07:00:00.000Z',
    );
    const acknowledge = report.phases.find((phase) => phase.phase === 'acknowledge');
    expect(acknowledge?.state).toBe('met_late');
    expect(acknowledge?.lateByHours).toBe(6);
    expect(report.breached).toBe(true);
  });

  it('treats an acknowledgement exactly on the deadline as on time', () => {
    const report = slaReport(
      milestones({ acknowledgedAt: '2026-10-02T00:00:00.000Z' }),
      'normal',
      '2026-10-02T01:00:00.000Z',
    );
    const acknowledge = report.phases.find((phase) => phase.phase === 'acknowledge');
    expect(acknowledge?.state).toBe('met');
  });

  it('marks a phase overdue once the deadline passes with no milestone', () => {
    const report = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    const acknowledge = report.phases.find((phase) => phase.phase === 'acknowledge');
    expect(acknowledge?.state).toBe('overdue');
    expect(acknowledge?.lateByHours).toBe(4);
  });

  it('reports the worst state across phases', () => {
    const report = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    expect(report.worstState).toBe('overdue');
  });

  it('escalates further as more phases slip', () => {
    const single = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    const many = slaReport(milestones(), 'critical', '2026-10-15T00:00:00.000Z');
    expect(many.escalation).toBeGreaterThan(single.escalation);
    expect(many.escalation).toBeLessThanOrEqual(3);
  });

  it('records the policy version and the frozen timestamp', () => {
    const report = slaReport(milestones(), 'high', '2026-10-01T01:00:00.000Z');
    expect(report.policyVersion).toBe(SLA_POLICY_VERSION);
    expect(report.frozenAt).toBe(SUBMITTED);
  });

  it('never reports a negative remaining time as pending', () => {
    const report = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    for (const phase of report.phases) {
      expect(phase.remainingHours === null || phase.remainingHours >= 0).toBe(true);
    }
  });

  it('does not breach when everything was met on time', () => {
    const report = slaReport(
      milestones({
        acknowledgedAt: '2026-10-01T01:00:00.000Z',
        respondedAt: '2026-10-02T00:00:00.000Z',
        resolvedAt: '2026-10-05T00:00:00.000Z',
      }),
      'normal',
      '2026-10-10T00:00:00.000Z',
    );
    expect(report.breached).toBe(false);
    expect(slaBreaches(report)).toEqual([]);
  });
});

describe('slaBreaches', () => {
  it('lists only overdue or late phases', () => {
    const report = slaReport(
      milestones({ acknowledgedAt: '2026-10-02T06:00:00.000Z' }),
      'normal',
      '2026-10-02T07:00:00.000Z',
    );
    const breached = slaBreaches(report);
    expect(breached.map((phase) => phase.phase)).toContain('acknowledge');
    expect(breached.every((phase) => phase.state !== 'met')).toBe(true);
  });
});

describe('slaEscalationLine', () => {
  it('states that nothing is late when the report is clean', () => {
    const report = slaReport(
      milestones({
        acknowledgedAt: '2026-10-01T01:00:00.000Z',
        respondedAt: '2026-10-02T00:00:00.000Z',
        resolvedAt: '2026-10-03T00:00:00.000Z',
      }),
      'normal',
      '2026-10-04T00:00:00.000Z',
    );
    expect(slaEscalationLine(report)).toContain('Tidak ada tenggat yang terlewat');
  });

  it('names the late phase and the escalation level', () => {
    const report = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    const line = slaEscalationLine(report);
    expect(line).toContain('pengakuan');
    expect(line).toContain('eskalasi');
  });

  it('mentions the remaining time while a phase is pending', () => {
    const report = slaReport(milestones(), 'normal', '2026-10-01T01:00:00.000Z');
    expect(slaEscalationLine(report)).toContain('sisa');
  });
});

describe('describeSlaPhase', () => {
  it('describes each state in Indonesian', () => {
    const report = slaReport(milestones(), 'critical', '2026-10-01T06:00:00.000Z');
    const acknowledge = report.phases.find((phase) => phase.phase === 'acknowledge');
    expect(describeSlaPhase(acknowledge!)).toContain('lewat 4 jam');
  });
});

describe('slaCaveats', () => {
  it('separates process compliance from outcome quality', () => {
    const text = slaCaveats().join(' ');
    expect(text).toContain('bukan kualitas perbaikan');
    expect(text).toContain('tidak mengubah tenggat laporan lama');
  });
});
