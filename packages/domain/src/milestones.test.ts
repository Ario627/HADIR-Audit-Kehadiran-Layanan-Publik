import { describe, expect, it } from 'vitest';
import {
  describeMilestone,
  isTerminalMilestone,
  milestoneCaveats,
  milestoneCompletionByEvents,
  milestoneGaps,
  milestoneLabel,
  milestoneOfEvent,
  milestoneSequence,
  slaMilestonesFrom,
  type MilestoneEvent,
  type ReportEventKind,
} from './milestones';

let counter = 0;

function event(kind: ReportEventKind, overrides: Partial<MilestoneEvent> = {}): MilestoneEvent {
  counter += 1;
  return {
    seq: counter,
    kind,
    actorType: 'citizen',
    actorId: 'device-1',
    createdAt: `2026-10-0${Math.min(9, counter)}T00:00:00.000Z`,
    ...overrides,
  };
}

function sequence(kinds: readonly ReportEventKind[]): MilestoneEvent[] {
  counter = 0;
  return kinds.map((kind) => event(kind));
}

describe('milestoneOfEvent', () => {
  it('maps process events to milestones', () => {
    expect(milestoneOfEvent('submitted')).toBe('submitted');
    expect(milestoneOfEvent('verified_resolved')).toBe('verified_resolved');
  });

  it('ignores bookkeeping events', () => {
    expect(milestoneOfEvent('moderated')).toBeNull();
    expect(milestoneOfEvent('corrected')).toBeNull();
    expect(milestoneOfEvent('info_requested')).toBeNull();
  });
});

describe('milestoneSequence', () => {
  it('is ordered from submission to verification', () => {
    const keys = milestoneSequence();
    expect(keys[0]).toBe('submitted');
    expect(keys[keys.length - 1]).toBe('verified_resolved');
    expect(keys.indexOf('claimed_resolved')).toBeLessThan(
      keys.indexOf('verified_resolved'),
    );
  });

  it('marks only outcome keys as terminal', () => {
    expect(isTerminalMilestone('verified_resolved')).toBe(true);
    expect(isTerminalMilestone('disputed')).toBe(true);
    expect(isTerminalMilestone('rejected')).toBe(true);
    expect(isTerminalMilestone('acknowledged')).toBe(false);
  });

  it('labels every milestone', () => {
    for (const key of milestoneSequence()) {
      expect(milestoneLabel(key).length).toBeGreaterThan(3);
    }
    expect(milestoneLabel('disputed')).toContain('disengketakan');
  });
});

describe('milestoneCompletionByEvents', () => {
  it('records each milestone once even if the event repeats', () => {
    const tracker = milestoneCompletionByEvents(
      sequence(['submitted', 'acknowledged', 'acknowledged', 'responded']),
    );
    const keys = tracker.entries.map((entry) => entry.key);
    expect(keys).toEqual(['submitted', 'acknowledged', 'responded']);
  });

  it('sorts by sequence number, not input order', () => {
    const submitted = event('submitted', { seq: 1 });
    const acknowledged = event('acknowledged', { seq: 2 });
    const tracker = milestoneCompletionByEvents([acknowledged, submitted]);
    expect(tracker.entries.map((entry) => entry.key)).toEqual([
      'submitted',
      'acknowledged',
    ]);
  });

  it('reports the current and next milestone', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'acknowledged']));
    expect(tracker.current).toBe('acknowledged');
    expect(tracker.next).toBe('scheduled');
  });

  it('exposes partial progress as a fraction of the canonical sequence', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'triaged']));
    expect(tracker.progress).toBeGreaterThan(0);
    expect(tracker.progress).toBeLessThan(1);
  });

  it('treats a verified resolution as terminal with full progress', () => {
    const tracker = milestoneCompletionByEvents(
      sequence(['submitted', 'acknowledged', 'claimed_resolved', 'verified_resolved']),
    );
    expect(tracker.terminal).toBe('resolved');
    expect(tracker.progress).toBe(1);
    expect(tracker.next).toBeNull();
  });

  it('treats a dispute as terminal but not successful', () => {
    const tracker = milestoneCompletionByEvents(
      sequence(['submitted', 'acknowledged', 'claimed_resolved', 'disputed']),
    );
    expect(tracker.terminal).toBe('disputed');
    expect(tracker.progress).toBe(1);
    expect(tracker.next).toBeNull();
  });

  it('treats a rejection as terminal', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'rejected']));
    expect(tracker.terminal).toBe('rejected');
    expect(tracker.next).toBeNull();
  });

  it('flags a pending information request', () => {
    const tracker = milestoneCompletionByEvents(
      sequence(['submitted', 'acknowledged', 'info_requested']),
    );
    expect(tracker.pendingInfoRequest).toBe(true);
  });

  it('clears the information request once a response lands', () => {
    const tracker = milestoneCompletionByEvents(
      sequence(['submitted', 'info_requested', 'responded']),
    );
    expect(tracker.pendingInfoRequest).toBe(false);
  });

  it('handles an empty event list without inventing progress', () => {
    const tracker = milestoneCompletionByEvents([]);
    expect(tracker.entries).toEqual([]);
    expect(tracker.current).toBeNull();
    expect(tracker.progress).toBe(0);
    expect(tracker.terminal).toBeNull();
  });
});

describe('milestoneGaps', () => {
  it('lists the milestones still missing for an open report', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'acknowledged']));
    expect(milestoneGaps(tracker)).toContain('responded');
    expect(milestoneGaps(tracker)).not.toContain('submitted');
  });

  it('returns nothing once the case is terminal', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'rejected']));
    expect(milestoneGaps(tracker)).toEqual([]);
  });
});

describe('slaMilestonesFrom', () => {
  it('extracts the timestamps used by the SLA engine', () => {
    const milestones = slaMilestonesFrom(
      sequence(['submitted', 'acknowledged', 'responded', 'verified_resolved']),
    );
    expect(milestones.submittedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(milestones.acknowledgedAt).toBe('2026-10-02T00:00:00.000Z');
    expect(milestones.respondedAt).toBe('2026-10-03T00:00:00.000Z');
    expect(milestones.resolvedAt).toBe('2026-10-04T00:00:00.000Z');
  });

  it('keeps the first occurrence of each milestone', () => {
    const first = event('acknowledged', { seq: 2, createdAt: '2026-10-02T00:00:00.000Z' });
    const second = event('acknowledged', { seq: 5, createdAt: '2026-10-05T00:00:00.000Z' });
    const milestones = slaMilestonesFrom([first, second]);
    expect(milestones.acknowledgedAt).toBe('2026-10-02T00:00:00.000Z');
  });

  it('never returns null for the submission time', () => {
    const milestones = slaMilestonesFrom([]);
    expect(milestones.submittedAt).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('describeMilestone', () => {
  it('describes a verified resolution', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'verified_resolved']));
    expect(describeMilestone(tracker)).toContain('diverifikasi');
  });

  it('describes a dispute', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'disputed']));
    expect(describeMilestone(tracker)).toContain('dibantah');
  });

  it('describes a rejection', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'rejected']));
    expect(describeMilestone(tracker)).toContain('Ditolak');
  });

  it('names the last and next milestone for an open case', () => {
    const tracker = milestoneCompletionByEvents(sequence(['submitted', 'acknowledged']));
    const text = describeMilestone(tracker);
    expect(text).toContain('Diakui instansi');
    expect(text).toContain('Dijadwalkan');
  });

  it('handles a case with no events', () => {
    expect(describeMilestone(milestoneCompletionByEvents([]))).toContain('Belum ada tahapan');
  });
});

describe('milestoneCaveats', () => {
  it('says the ordering cannot be rewritten', () => {
    const text = milestoneCaveats().join(' ');
    expect(text).toContain('tidak dapat disunting ulang');
    expect(text).toContain('bukan mutu hasil');
  });
});
