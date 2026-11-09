import { describe, expect, it } from 'vitest';
import {
  benchmarkMessage,
  commitmentCaveats,
  commitmentChanges,
  dayScopeForDate,
  describeCommitment,
  overlappingCommitmentIds,
  resolveBenchmark,
  unavailableMessage,
  validOn,
  type CommitmentRecord,
} from './commitment';

const ROUTE = '0192f0c4-0000-7000-8000-0000000000b1';
const STOP = '0192f0c4-0000-7000-8000-0000000000c1';

function record(overrides: Partial<CommitmentRecord> = {}): CommitmentRecord {
  return {
    id: '0192f0c4-0000-7000-8000-0000000000e1',
    routeId: ROUTE,
    stopId: null,
    kind: 'headway',
    dayScope: 'all',
    headwayMin: 12,
    spanStart: null,
    spanEnd: null,
    sourceDocumentUrl: 'https://dinhub.test/spm-2026.pdf',
    sourceDocumentTitle: 'SPM 2026',
    sourceDocumentVersion: 'v1',
    validFrom: '2026-01-01',
    validUntil: '2026-12-31',
    status: 'verified',
    verifiedAt: '2026-01-05T00:00:00.000Z',
    institutionName: 'Dinhub Banyumas',
    ...overrides,
  };
}

describe('dayScopeForDate', () => {
  it('classifies weekday and weekend correctly', () => {
    expect(dayScopeForDate('2026-10-12')).toBe('weekday');
    expect(dayScopeForDate('2026-10-17')).toBe('weekend');
    expect(dayScopeForDate('2026-10-18')).toBe('weekend');
  });

  it('returns null for malformed dates', () => {
    expect(dayScopeForDate('12-10-2026')).toBeNull();
    expect(dayScopeForDate('2026-13-01')).toBeNull();
  });
});

describe('resolveBenchmark', () => {
  it('resolves a verified route level commitment', () => {
    const result = resolveBenchmark([record()], {
      routeId: ROUTE,
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }
    expect(result.headwayMin).toBe(12);
    expect(result.idealWaitMin).toBe(6);
    expect(result.thresholdMin).toBe(7.5);
    expect(result.specificity).toBe('route');
  });

  it('prefers a stop level commitment over a route level one', () => {
    const result = resolveBenchmark(
      [
        record(),
        record({ id: 'stop-level', stopId: STOP, headwayMin: 8, routeId: null }),
      ],
      { routeId: ROUTE, stopId: STOP, onDate: '2026-10-12' },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }
    expect(result.headwayMin).toBe(8);
    expect(result.specificity).toBe('stop');
  });

  it('prefers a narrower day scope over a blanket one', () => {
    const result = resolveBenchmark(
      [
        record({ id: 'blanket', dayScope: 'all', headwayMin: 15 }),
        record({ id: 'weekday', dayScope: 'weekday', headwayMin: 9 }),
      ],
      { routeId: ROUTE, onDate: '2026-10-12' },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }
    expect(result.headwayMin).toBe(9);
  });

  it('falls back to the blanket commitment on a weekend', () => {
    const result = resolveBenchmark(
      [
        record({ id: 'blanket', dayScope: 'all', headwayMin: 15 }),
        record({ id: 'weekday', dayScope: 'weekday', headwayMin: 9 }),
      ],
      { routeId: ROUTE, onDate: '2026-10-17' },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }
    expect(result.headwayMin).toBe(15);
  });

  it('honours the newest valid_from when two same-scope commitments are both in force', () => {
    const result = resolveBenchmark(
      [
        record({ id: 'older', validFrom: '2026-01-01', validUntil: '2026-12-31', headwayMin: 15 }),
        record({ id: 'newer', validFrom: '2026-06-01', validUntil: '2026-12-31', headwayMin: 10 }),
      ],
      { routeId: ROUTE, onDate: '2026-10-12' },
    );
    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') {
      return;
    }
    expect(result.commitment.id).toBe('newer');
    expect(result.headwayMin).toBe(10);
  });

  it('refuses to use a draft commitment', () => {
    const result = resolveBenchmark([record({ status: 'draft' })], {
      routeId: ROUTE,
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') {
      return;
    }
    expect(result.reason).toBe('not_verified');
    expect(result.considered).toBe(1);
  });

  it('refuses to use a revoked commitment', () => {
    const result = resolveBenchmark([record({ status: 'revoked' })], {
      routeId: ROUTE,
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('unavailable');
  });

  it('reports outside_validity instead of borrowing a later promise', () => {
    const result = resolveBenchmark(
      [record({ validFrom: '2026-01-01', validUntil: '2026-06-30' })],
      { routeId: ROUTE, onDate: '2026-10-12' },
    );
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') {
      return;
    }
    expect(result.reason).toBe('outside_validity');
  });

  it('accepts an open ended commitment', () => {
    const result = resolveBenchmark([record({ validUntil: null })], {
      routeId: ROUTE,
      onDate: '2031-01-01',
    });
    expect(result.status).toBe('resolved');
  });

  it('reports missing_headway when the document carries no number', () => {
    const result = resolveBenchmark([record({ headwayMin: null })], {
      routeId: ROUTE,
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') {
      return;
    }
    expect(result.reason).toBe('missing_headway');
  });

  it('ignores span commitments when resolving a headway benchmark', () => {
    const result = resolveBenchmark([record({ kind: 'span', headwayMin: null })], {
      routeId: ROUTE,
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('unavailable');
  });

  it('never matches a commitment from another route', () => {
    const result = resolveBenchmark([record()], {
      routeId: '0192f0c4-0000-7000-8000-0000000000ff',
      onDate: '2026-10-12',
    });
    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') {
      return;
    }
    expect(result.reason).toBe('no_commitment');
  });

  it('requires an explicit holiday scope because holidays are not inferred', () => {
    const holiday = record({ dayScope: 'holiday', headwayMin: 20 });
    const withoutCalendar = resolveBenchmark([holiday], {
      routeId: ROUTE,
      onDate: '2026-12-25',
    });
    expect(withoutCalendar.status).toBe('unavailable');

    const withCalendar = resolveBenchmark([holiday], {
      routeId: ROUTE,
      onDate: '2026-12-25',
      dayScope: 'holiday',
    });
    expect(withCalendar.status).toBe('resolved');
  });

  it('rejects a query with neither route nor stop', () => {
    const result = resolveBenchmark([record()], { onDate: '2026-10-12' });
    expect(result.status).toBe('unavailable');
  });

  it('rejects an unparsable date', () => {
    const result = resolveBenchmark([record()], { routeId: ROUTE, onDate: 'kemarin' });
    expect(result.status).toBe('unavailable');
  });

  it('is deterministic regardless of input order', () => {
    const a = record({ id: 'a', headwayMin: 15 });
    const b = record({ id: 'b', headwayMin: 10, validFrom: '2026-06-01' });
    const first = resolveBenchmark([a, b], { routeId: ROUTE, onDate: '2026-10-12' });
    const second = resolveBenchmark([b, a], { routeId: ROUTE, onDate: '2026-10-12' });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('unavailableMessage', () => {
  it('says benchmark unavailable for every reason', () => {
    for (const reason of [
      'no_commitment',
      'not_verified',
      'outside_validity',
      'scope_mismatch',
      'missing_headway',
    ] as const) {
      expect(unavailableMessage(reason).length).toBeGreaterThan(20);
    }
  });

  it('never fabricates a fallback number', () => {
    const text = unavailableMessage('no_commitment');
    expect(text).not.toMatch(/\d+\s*menit/);
  });
});

describe('benchmarkMessage', () => {
  it('states the threshold when resolved', () => {
    const resolved = resolveBenchmark([record()], { routeId: ROUTE, onDate: '2026-10-12' });
    const text = benchmarkMessage(resolved);
    expect(text).toContain('12');
    expect(text).toContain('7.5');
  });

  it('states benchmark unavailable when unresolved', () => {
    const unresolved = resolveBenchmark([], { routeId: ROUTE, onDate: '2026-10-12' });
    expect(benchmarkMessage(unresolved)).toContain('tidak tersedia');
  });
});

describe('commitmentChanges', () => {
  it('orders verified changes newest first', () => {
    const changes = commitmentChanges(
      [
        record({ id: 'a', validFrom: '2026-01-01', validUntil: '2026-05-31' }),
        record({ id: 'b', validFrom: '2026-06-01', validUntil: '2026-12-31' }),
      ],
      '2026-10-12',
    );
    expect(changes.map((change) => change.validFrom)).toEqual(['2026-06-01', '2026-01-01']);
  });

  it('excludes drafts', () => {
    const changes = commitmentChanges([record({ status: 'draft' })], '2026-10-12');
    expect(changes).toEqual([]);
  });

  it('computes the covered day count', () => {
    const changes = commitmentChanges(
      [record({ validFrom: '2026-01-01', validUntil: '2026-01-10' })],
      '2026-10-12',
    );
    expect(changes[0]?.days).toBe(10);
  });
});

describe('describeCommitment', () => {
  it('summarises scope, target and validity', () => {
    const text = describeCommitment(record({ dayScope: 'weekday', headwayMin: 9 }));
    expect(text).toContain('hari kerja');
    expect(text).toContain('9 menit');
    expect(text).toContain('2026-01-01');
  });

  it('handles a commitment without a headway number', () => {
    expect(describeCommitment(record({ headwayMin: null, kind: 'span' }))).toContain(
      'tanpa angka headway',
    );
  });
});

describe('validOn', () => {
  it('is true only for verified records covering the date', () => {
    expect(validOn(record(), '2026-10-12')).toBe(true);
    expect(validOn(record(), '2027-10-12')).toBe(false);
    expect(validOn(record({ status: 'draft' }), '2026-10-12')).toBe(false);
  });
});

describe('overlappingCommitmentIds', () => {
  it('detects two verified commitments covering the same day', () => {
    const pairs = overlappingCommitmentIds([
      record({ id: 'a', validFrom: '2026-01-01', validUntil: '2026-12-31' }),
      record({ id: 'b', validFrom: '2026-06-01', validUntil: '2026-12-31' }),
    ]);
    expect(pairs).toEqual([['a', 'b']]);
  });

  it('accepts adjacent non-overlapping windows', () => {
    const pairs = overlappingCommitmentIds([
      record({ id: 'a', validFrom: '2026-01-01', validUntil: '2026-06-30' }),
      record({ id: 'b', validFrom: '2026-07-01', validUntil: '2026-12-31' }),
    ]);
    expect(pairs).toEqual([]);
  });

  it('ignores different day scopes', () => {
    const pairs = overlappingCommitmentIds([
      record({ id: 'a', dayScope: 'all' }),
      record({ id: 'b', dayScope: 'weekday' }),
    ]);
    expect(pairs).toEqual([]);
  });
});

describe('commitmentCaveats', () => {
  it('states that benchmarks are never invented', () => {
    const text = commitmentCaveats().join(' ');
    expect(text).toContain('tidak mengarang angka');
    expect(text).toContain('Hari libur');
  });
});
