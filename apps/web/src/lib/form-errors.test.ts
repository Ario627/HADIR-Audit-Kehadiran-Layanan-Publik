import { describe, expect, it } from 'vitest';
import {
  MAX_ISSUES,
  SUMMARY_TITLE_MANY,
  SUMMARY_TITLE_NONE,
  SUMMARY_TITLE_ONE,
  dedupeIssues,
  describedByFor,
  firstIssue,
  focusableTarget,
  hasIssueFor,
  issueElementId,
  issueFor,
  issuesSignature,
  scrollBehavior,
  summaryCount,
  summaryTitle,
  type FieldIssue,
} from './form-errors';

function issue(field: string, message = 'pesan'): FieldIssue {
  return { field, label: `Label ${field}`, message };
}

describe('summaryTitle', () => {
  it('distinguishes zero, one, and many', () => {
    expect(summaryTitle(0)).toBe(SUMMARY_TITLE_NONE);
    expect(summaryTitle(1)).toBe(SUMMARY_TITLE_ONE);
    expect(summaryTitle(2)).toBe(SUMMARY_TITLE_MANY);
    expect(summaryTitle(9)).toBe(SUMMARY_TITLE_MANY);
  });

  it('treats junk counts as zero', () => {
    expect(summaryTitle(-3)).toBe(SUMMARY_TITLE_NONE);
    expect(summaryTitle(Number.NaN)).toBe(SUMMARY_TITLE_NONE);
    expect(summaryTitle(1.7)).toBe(SUMMARY_TITLE_ONE);
  });
});

describe('summaryCount', () => {
  it('uses the singular for one problem', () => {
    expect(summaryCount(1)).toBe('1 masalah');
    expect(summaryCount(3)).toBe('3 masalah');
  });
});

describe('issueElementId', () => {
  it('appends the error suffix', () => {
    expect(issueElementId('teks-laporan')).toBe('teks-laporan-galat');
    expect(issueElementId('action-note')).toBe('action-note-galat');
  });
});

describe('describedByFor', () => {
  it('returns the hint alone when there is no error', () => {
    expect(describedByFor('teks-laporan', false, 'teks-hint')).toBe('teks-hint');
  });

  it('returns the error alone when there is no hint', () => {
    expect(describedByFor('teks-laporan', true)).toBe('teks-laporan-galat');
  });

  it('joins hint and error', () => {
    expect(describedByFor('teks-laporan', true, 'teks-hint')).toBe(
      'teks-hint teks-laporan-galat',
    );
  });

  it('returns undefined when there is nothing to describe', () => {
    expect(describedByFor('teks-laporan', false)).toBeUndefined();
    expect(describedByFor('teks-laporan', false, '')).toBeUndefined();
  });
});

describe('dedupeIssues', () => {
  it('keeps the first message per field', () => {
    const result = dedupeIssues([issue('a', 'pertama'), issue('a', 'kedua'), issue('b')]);
    expect(result).toHaveLength(2);
    expect(result[0]?.message).toBe('pertama');
  });

  it('drops entries with an empty field or message', () => {
    expect(dedupeIssues([issue('', 'x'), issue('a', ''), issue('b')])).toHaveLength(1);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_ISSUES + 5 }, (_, index) => issue(`f${index}`));
    expect(dedupeIssues(many)).toHaveLength(MAX_ISSUES);
  });

  it('returns an empty list for no issues', () => {
    expect(dedupeIssues([])).toEqual([]);
  });
});

describe('issueFor and hasIssueFor', () => {
  const issues = [issue('a', 'salah a'), issue('b', 'salah b')];

  it('finds a message by field', () => {
    expect(issueFor(issues, 'a')).toBe('salah a');
    expect(issueFor(issues, 'b')).toBe('salah b');
  });

  it('returns null for a clean field', () => {
    expect(issueFor(issues, 'c')).toBeNull();
    expect(hasIssueFor(issues, 'c')).toBe(false);
  });

  it('reports presence', () => {
    expect(hasIssueFor(issues, 'a')).toBe(true);
    expect(hasIssueFor([], 'a')).toBe(false);
  });
});

describe('firstIssue', () => {
  it('returns the first problem so focus lands there', () => {
    expect(firstIssue([issue('a'), issue('b')])?.field).toBe('a');
  });

  it('returns null for a clean form', () => {
    expect(firstIssue([])).toBeNull();
  });
});

describe('issuesSignature', () => {
  it('changes when a message changes', () => {
    expect(issuesSignature([issue('a', 'x')])).not.toBe(issuesSignature([issue('a', 'y')]));
  });

  it('is stable for the same issues', () => {
    expect(issuesSignature([issue('a')])).toBe(issuesSignature([issue('a')]));
  });

  it('is empty for no issues', () => {
    expect(issuesSignature([])).toBe('');
  });
});

describe('focusableTarget', () => {
  it('accepts an element id', () => {
    expect(focusableTarget('teks-laporan')).toBe('teks-laporan');
    expect(focusableTarget('kategori-laporan')).toBe('kategori-laporan');
  });

  it('trims surrounding whitespace', () => {
    expect(focusableTarget('  action-note  ')).toBe('action-note');
  });

  it('refuses an empty or overlong id', () => {
    expect(focusableTarget('')).toBeNull();
    expect(focusableTarget('   ')).toBeNull();
    expect(focusableTarget('a'.repeat(81))).toBeNull();
  });

  it('refuses a selector injection attempt', () => {
    expect(focusableTarget('a[href]')).toBeNull();
    expect(focusableTarget('#main')).toBeNull();
    expect(focusableTarget('a b')).toBeNull();
    expect(focusableTarget('1abc')).toBeNull();
    expect(focusableTarget('a>n')).toBeNull();
  });

  it('accepts digits, dashes, and underscores after the first letter', () => {
    expect(focusableTarget('field_1-a')).toBe('field_1-a');
  });
});

describe('scrollBehavior', () => {
  it('honours the reduced motion preference', () => {
    expect(scrollBehavior(true)).toBe('auto');
    expect(scrollBehavior(false)).toBe('smooth');
  });
});
