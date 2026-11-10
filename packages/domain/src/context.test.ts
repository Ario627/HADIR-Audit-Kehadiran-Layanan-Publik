import { describe, expect, it } from 'vitest';
import {
  annotateObservations,
  contextCaveats,
  contextMessage,
  contextWarningCode,
  describedPeriod,
  eventWindow,
  impactRank,
  mergeTimeline,
  requiresAcknowledgement,
  summariseContext,
  windowDurationMinutes,
  withinAnyWindow,
  worstImpact,
  type ObservationMoment,
  type OperationalEvent,
} from './context';

const NOW = '2026-10-19T00:00:00.000Z';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';

function event(overrides: Partial<OperationalEvent> = {}): OperationalEvent {
  return {
    id: 'evt-1',
    kind: 'detour',
    impact: 'major',
    text: 'Pengalihan rute karena perbaikan jalan.',
    sourceUrl: 'https://dinhub.test/notice/1',
    startsAt: '2026-10-12T07:00:00.000Z',
    endsAt: '2026-10-12T10:00:00.000Z',
    stopId: STOP,
    routeId: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

function moment(at: string, day = '2026-10-12', hour = 7): ObservationMoment {
  return { at, day, hour };
}

describe('impactRank dan worstImpact', () => {
  it('orders impact severities', () => {
    expect(impactRank('none')).toBeLessThan(impactRank('minor'));
    expect(impactRank('minor')).toBeLessThan(impactRank('major'));
    expect(impactRank('major')).toBeLessThan(impactRank('service_stopped'));
  });

  it('picks the worse of two impacts', () => {
    expect(worstImpact('minor', 'major')).toBe('major');
    expect(worstImpact('service_stopped', 'major')).toBe('service_stopped');
    expect(worstImpact(null, 'minor')).toBe('minor');
    expect(worstImpact('major', null)).toBe('major');
    expect(worstImpact(null, null)).toBeNull();
  });
});

describe('eventWindow', () => {
  it('uses the declared start and end', () => {
    const window = eventWindow(event(), NOW);
    expect(window.start).toBe('2026-10-12T07:00:00.000Z');
    expect(window.end).toBe('2026-10-12T10:00:00.000Z');
    expect(window.openEnded).toBe(false);
    expect(window.openStart).toBe(false);
  });

  it('closes an open ended event at now', () => {
    const window = eventWindow(
      event({ startsAt: '2026-10-15T00:00:00.000Z', endsAt: null }),
      NOW,
    );
    expect(window.end).toBe(NOW);
    expect(window.openEnded).toBe(true);
  });

  it('backs off four hours when only the end is declared', () => {
    const window = eventWindow(
      event({ startsAt: null, endsAt: '2026-10-12T10:00:00.000Z' }),
      NOW,
    );
    expect(window.start).toBe('2026-10-12T06:00:00.000Z');
    expect(window.openStart).toBe(true);
  });

  it('never produces an inverted window', () => {
    const window = eventWindow(
      event({ startsAt: '2026-10-12T10:00:00.000Z', endsAt: '2026-10-12T08:00:00.000Z' }),
      NOW,
    );
    expect(new Date(window.end).getTime()).toBeGreaterThanOrEqual(
      new Date(window.start).getTime(),
    );
  });
});

describe('mergeTimeline', () => {
  it('keeps disjoint events separate', () => {
    const segments = mergeTimeline([
      eventWindow(
        event({ id: 'a', startsAt: '2026-10-12T06:00:00.000Z', endsAt: '2026-10-12T08:00:00.000Z' }),
        NOW,
      ),
      eventWindow(
        event({ id: 'b', startsAt: '2026-10-12T09:00:00.000Z', endsAt: '2026-10-12T11:00:00.000Z' }),
        NOW,
      ),
    ]);
    expect(segments).toHaveLength(2);
  });

  it('merges overlapping events and keeps the worst impact', () => {
    const segments = mergeTimeline([
      eventWindow(
        event({
          id: 'a',
          impact: 'minor',
          startsAt: '2026-10-12T06:00:00.000Z',
          endsAt: '2026-10-12T09:00:00.000Z',
        }),
        NOW,
      ),
      eventWindow(
        event({
          id: 'b',
          impact: 'service_stopped',
          startsAt: '2026-10-12T08:00:00.000Z',
          endsAt: '2026-10-12T11:00:00.000Z',
        }),
        NOW,
      ),
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.impact).toBe('service_stopped');
    expect(segments[0]?.eventIds).toEqual(['a', 'b']);
  });

  it('drops events with impact none from the timeline', () => {
    expect(mergeTimeline([eventWindow(event({ impact: 'none' }), NOW)])).toEqual([]);
  });
});

describe('annotateObservations', () => {
  it('counts observations inside an impacted window', () => {
    const result = annotateObservations(
      [
        moment('2026-10-12T07:30:00.000Z'),
        moment('2026-10-12T09:00:00.000Z'),
        moment('2026-10-12T15:00:00.000Z'),
      ],
      [event()],
      NOW,
    );
    expect(result.total).toBe(3);
    expect(result.annotated).toBe(2);
    expect(result.uncovered).toBe(1);
    expect(result.annotatedShare).toBeCloseTo(0.667, 3);
  });

  it('never removes observations, only annotates them', () => {
    const observations = [
      moment('2026-10-12T07:30:00.000Z'),
      moment('2026-10-12T09:00:00.000Z'),
    ];
    const result = annotateObservations(observations, [event()], NOW);
    expect(result.total).toBe(observations.length);
    expect(result.annotated + result.uncovered).toBe(observations.length);
  });

  it('returns zero annotations when nothing overlaps', () => {
    const result = annotateObservations(
      [moment('2026-11-01T07:00:00.000Z')],
      [event()],
      NOW,
    );
    expect(result.annotated).toBe(0);
    expect(result.worstImpact).toBeNull();
    expect(contextWarningCode(result)).toBeNull();
  });

  it('reports the worst impact seen across matched events', () => {
    const result = annotateObservations(
      [moment('2026-10-12T09:00:00.000Z')],
      [
        event({
          id: 'a',
          impact: 'minor',
          startsAt: '2026-10-12T06:00:00.000Z',
          endsAt: '2026-10-12T12:00:00.000Z',
        }),
        event({
          id: 'b',
          impact: 'service_stopped',
          startsAt: '2026-10-12T08:00:00.000Z',
          endsAt: '2026-10-12T10:00:00.000Z',
        }),
      ],
      NOW,
    );
    expect(result.worstImpact).toBe('service_stopped');
  });

  it('handles an empty observation set', () => {
    const result = annotateObservations([], [event()], NOW);
    expect(result.total).toBe(0);
    expect(result.annotatedShare).toBe(0);
  });

  it('ignores impact none events entirely', () => {
    const result = annotateObservations(
      [moment('2026-10-12T07:30:00.000Z')],
      [event({ impact: 'none' })],
      NOW,
    );
    expect(result.annotated).toBe(0);
  });
});

describe('contextWarningCode', () => {
  it('flags a service stopped overlap', () => {
    const result = annotateObservations(
      [moment('2026-10-12T07:30:00.000Z')],
      [event({ impact: 'service_stopped' })],
      NOW,
    );
    expect(contextWarningCode(result)).toBe('context_service_stopped');
  });

  it('flags a majority overlap', () => {
    const result = annotateObservations(
      [
        moment('2026-10-12T07:00:00.000Z'),
        moment('2026-10-12T08:00:00.000Z'),
        moment('2026-10-12T09:00:00.000Z'),
        moment('2026-10-12T20:00:00.000Z'),
      ],
      [event({ impact: 'minor' })],
      NOW,
    );
    expect(contextWarningCode(result)).toBe('context_explained_majority');
  });

  it('flags a partial overlap', () => {
    const result = annotateObservations(
      [
        moment('2026-10-12T07:30:00.000Z'),
        moment('2026-10-12T20:00:00.000Z'),
        moment('2026-10-12T21:00:00.000Z'),
      ],
      [event({ impact: 'minor' })],
      NOW,
    );
    expect(contextWarningCode(result)).toBe('context_partial_overlap');
  });
});

describe('contextMessage', () => {
  it('returns null when nothing is explained', () => {
    const result = annotateObservations([], [event()], NOW);
    expect(contextMessage(result)).toBeNull();
  });

  it('states that figures are not adjusted', () => {
    const result = annotateObservations(
      [moment('2026-10-12T07:30:00.000Z')],
      [event({ impact: 'service_stopped' })],
      NOW,
    );
    const message = contextMessage(result);
    expect(message).toContain('tidak dihapus');
    expect(message).toContain('tanpa penyesuaian');
  });
});

describe('summariseContext', () => {
  it('combines events, windows and merged segments', () => {
    const summary = summariseContext([event(), event({ id: 'evt-2', impact: 'minor' })], NOW);
    expect(summary.events).toHaveLength(2);
    expect(summary.windows).toHaveLength(2);
    expect(summary.dominantImpact).toBe('major');
    expect(summary.caveats.length).toBeGreaterThanOrEqual(4);
  });

  it('handles no events', () => {
    const summary = summariseContext([], NOW);
    expect(summary.dominantImpact).toBeNull();
    expect(summary.segments).toEqual([]);
  });
});

describe('contextCaveats', () => {
  it('states that context never deletes observations', () => {
    const text = contextCaveats().join(' ');
    expect(text).toContain('bukan menghapus pengamatan');
    expect(text).toContain('Tidak ada observasi yang dibuang otomatis');
    expect(text).toContain('hak menjawab');
  });
});

describe('helper utilitas', () => {
  it('measures window duration in minutes', () => {
    expect(windowDurationMinutes(eventWindow(event(), NOW))).toBe(180);
  });

  it('detects whether a moment falls in any window', () => {
    const windows = [eventWindow(event(), NOW)];
    expect(withinAnyWindow('2026-10-12T08:00:00.000Z', windows)).toBe(true);
    expect(withinAnyWindow('2026-10-12T23:00:00.000Z', windows)).toBe(false);
  });

  it('requires acknowledgement only for severe impacts', () => {
    expect(requiresAcknowledgement('service_stopped')).toBe(true);
    expect(requiresAcknowledgement('major')).toBe(true);
    expect(requiresAcknowledgement('minor')).toBe(false);
    expect(requiresAcknowledgement('none')).toBe(false);
  });

  it('formats a segment description using the supplied formatter', () => {
    const text = describedPeriod(
      {
        start: '2026-10-12T07:00:00.000Z',
        end: '2026-10-12T10:00:00.000Z',
        impact: 'major',
        eventIds: ['a', 'b'],
      },
      (iso) => iso.slice(11, 16),
    );
    expect(text).toContain('07:00');
    expect(text).toContain('10:00');
    expect(text).toContain('gangguan besar');
    expect(text).toContain('2 catatan');
  });
});
