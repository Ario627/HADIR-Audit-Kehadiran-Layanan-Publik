export interface FieldIssue {
  field: string;
  label: string;
  message: string;
}

export const SUMMARY_TITLE_ONE = 'Ada satu hal yang perlu diperbaiki';
export const SUMMARY_TITLE_MANY = 'Ada beberapa hal yang perlu diperbaiki';
export const SUMMARY_TITLE_NONE = 'Tidak ada yang perlu diperbaiki';
export const MAX_ISSUES = 12;

const ISSUE_SUFFIX = '-galat';

function clampCount(count: number): number {
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }
  return Math.floor(count);
}

export function summaryTitle(count: number): string {
  const safe = clampCount(count);
  if (safe === 0) {
    return SUMMARY_TITLE_NONE;
  }
  if (safe === 1) {
    return SUMMARY_TITLE_ONE;
  }
  return SUMMARY_TITLE_MANY;
}

export function summaryCount(count: number): string {
  const safe = clampCount(count);
  return safe === 1 ? '1 masalah' : `${safe} masalah`;
}

export function issueElementId(field: string): string {
  return `${field}${ISSUE_SUFFIX}`;
}

export function describedByFor(
  field: string,
  hasIssue: boolean,
  extra?: string,
): string | undefined {
  const parts: string[] = [];
  if (extra !== undefined && extra.length > 0) {
    parts.push(extra);
  }
  if (hasIssue) {
    parts.push(issueElementId(field));
  }
  return parts.length === 0 ? undefined : parts.join(' ');
}

export function dedupeIssues(issues: readonly FieldIssue[]): FieldIssue[] {
  const seen = new Set<string>();
  const output: FieldIssue[] = [];
  for (const issue of issues) {
    if (issue.field.length === 0 || issue.message.length === 0 || seen.has(issue.field)) {
      continue;
    }
    seen.add(issue.field);
    output.push(issue);
    if (output.length >= MAX_ISSUES) {
      break;
    }
  }
  return output;
}

export function issueFor(issues: readonly FieldIssue[], field: string): string | null {
  const found = issues.find((issue) => issue.field === field);
  return found === undefined ? null : found.message;
}

export function hasIssueFor(issues: readonly FieldIssue[], field: string): boolean {
  return issues.some((issue) => issue.field === field);
}

export function firstIssue(issues: readonly FieldIssue[]): FieldIssue | null {
  return issues.length === 0 ? null : (issues[0] as FieldIssue);
}

export function issuesSignature(issues: readonly FieldIssue[]): string {
  return issues.map((issue) => `${issue.field}:${issue.message}`).join('|');
}

export function focusableTarget(field: string): string | null {
  const trimmed = field.trim();
  if (trimmed.length === 0 || trimmed.length > 80) {
    return null;
  }
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function scrollBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? 'auto' : 'smooth';
}