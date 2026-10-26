import {
  daysBetween,
  daysRemaining,
  deriveStatus,
  disclaimerFor,
  jakartaToday,
  latestMeaningfulEvent,
  sanctionsFor,
  urgencyBand,
} from './runway.timing';

const TODAY = { today: '2026-10-26' };

describe('jakartaToday', () => {
  it('rolls to the next day at 17:00 UTC', () => {
    expect(jakartaToday(new Date('2026-10-25T16:59:00.000Z'))).toBe('2026-10-25');
    expect(jakartaToday(new Date('2026-10-25T17:00:00.000Z'))).toBe('2026-10-26');
  });

  it('differs from the UTC date late in the day', () => {
    const late = new Date('2026-10-26T23:59:00.000Z');
    expect(late.toISOString().slice(0, 10)).toBe('2026-10-26');
    expect(jakartaToday(late)).toBe('2026-10-27');
  });
});

describe('daysBetween', () => {
  it('counts whole calendar days', () => {
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-10-26', '2027-01-01')).toBe(67);
  });

  it('is negative when the target is in the past', () => {
    expect(daysBetween('2026-10-26', '2026-10-21')).toBe(-5);
  });

  it('returns null for malformed input', () => {
    expect(daysBetween('bukan-tanggal', '2026-11-02')).toBeNull();
  });

  it('does not drift across a 30 day month', () => {
    expect(daysBetween('2026-06-01', '2026-07-01')).toBe(30);
  });
});

describe('daysRemaining', () => {
  it('returns null without a funded date', () => {
    expect(daysRemaining(null, TODAY)).toBeNull();
  });

  it('counts down to a future date', () => {
    expect(daysRemaining('2026-12-31', TODAY)).toBe(66);
  });
});

describe('deriveStatus', () => {
  it('keeps a stopped service stopped regardless of dates', () => {
    expect(
      deriveStatus({ declared: 'stopped', fundedUntil: '2099-01-01', clock: TODAY }),
    ).toBe('stopped');
  });

  it('downgrades a funded service whose date has passed', () => {
    expect(
      deriveStatus({ declared: 'funded', fundedUntil: '2026-10-01', clock: TODAY }),
    ).toBe('pending');
  });

  it('never invents a stopped status from a date alone', () => {
    expect(
      deriveStatus({ declared: 'funded', fundedUntil: '2020-01-01', clock: TODAY }),
    ).not.toBe('stopped');
  });

  it('promotes an unknown service that has a future date', () => {
    expect(
      deriveStatus({ declared: 'unknown', fundedUntil: '2027-06-30', clock: TODAY }),
    ).toBe('funded');
  });

  it('keeps pending without a date', () => {
    expect(deriveStatus({ declared: 'pending', fundedUntil: null, clock: TODAY })).toBe(
      'pending',
    );
  });

  it('keeps unknown without a date instead of guessing', () => {
    expect(deriveStatus({ declared: 'unknown', fundedUntil: null, clock: TODAY })).toBe(
      'unknown',
    );
  });
});

describe('urgencyBand', () => {
  it('separates the four urgent bands', () => {
    expect(urgencyBand(-1)).toBe('expired');
    expect(urgencyBand(0)).toBe('critical');
    expect(urgencyBand(30)).toBe('critical');
    expect(urgencyBand(31)).toBe('warning');
    expect(urgencyBand(90)).toBe('warning');
    expect(urgencyBand(91)).toBe('watch');
  });

  it('returns none when there is no date', () => {
    expect(urgencyBand(null)).toBe('none');
  });
});

describe('latestMeaningfulEvent', () => {
  it('returns null for an empty list', () => {
    expect(latestMeaningfulEvent([])).toBeNull();
  });

  it('uses the highest sequence, not a fixed priority', () => {
    const events = [
      { seq: 1, kind: 'announced' as const },
      { seq: 3, kind: 'stopped' as const },
      { seq: 2, kind: 'funded' as const },
    ];
    expect(latestMeaningfulEvent(events)?.kind).toBe('stopped');
  });

  it('lets a resumption supersede an earlier suspension', () => {
    const events = [
      { seq: 1, kind: 'suspended' as const },
      { seq: 2, kind: 'resumed' as const },
    ];
    expect(latestMeaningfulEvent(events)?.kind).toBe('resumed');
  });

  it('lets a later suspension supersede an earlier resumption', () => {
    const events = [
      { seq: 1, kind: 'resumed' as const },
      { seq: 2, kind: 'suspended' as const },
    ];
    expect(latestMeaningfulEvent(events)?.kind).toBe('suspended');
  });
});

describe('sanctionsFor', () => {
  it('returns nothing without a note', () => {
    expect(sanctionsFor(null)).toEqual([]);
  });

  it('splits on sentence separators', () => {
    expect(sanctionsFor('Denda 2%.Evaluasi bulanan')).toEqual(['Denda 2%', 'Evaluasi bulanan']);
  });

  it('caps the output at five entries', () => {
    const note = 'a;b;c;d;e;f;g';
    expect(sanctionsFor(note)).toHaveLength(5);
  });

  it('drops blank segments', () => {
    expect(sanctionsFor(';;')).toEqual([]);
  });
});

describe('disclaimerFor', () => {
  it('never promises a prediction', () => {
    expect(disclaimerFor()).toContain('bukan prediksi');
  });
});
