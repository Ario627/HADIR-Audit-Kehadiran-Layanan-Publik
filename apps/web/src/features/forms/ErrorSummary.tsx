import { useEffect, useRef } from 'react';
import { focusableTarget, scrollBehavior, summaryTitle, type FieldIssue } from '../../lib/form-errors';

export interface ErrorSummaryProps {
  issues: readonly FieldIssue[];
  focusSignal: number;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function focusField(field: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const target = focusableTarget(field);
  if (target === null) {
    return;
  }
  const element = document.getElementById(target);
  if (element === null) {
    return;
  }
  element.focus();
  element.scrollIntoView({ block: 'center', behavior: scrollBehavior(prefersReducedMotion()) });
}

export function ErrorSummary({ issues, focusSignal }: ErrorSummaryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    if (node === null || issues.length === 0) {
      return;
    }
    node.focus();
  }, [focusSignal, issues.length]);

  if (issues.length === 0) {
    return null;
  }

  return (
    <div
      className="errorsummary"
      role="alert"
      tabIndex={-1}
      ref={containerRef}
      aria-labelledby="errorsummary-title"
    >
      <p className="errorsummary-title" id="errorsummary-title">
        {summaryTitle(issues.length)}
      </p>
      <ul className="errorsummary-list">
        {issues.map((issue) => (
          <li key={issue.field}>
            <button
              type="button"
              className="errorsummary-link"
              onClick={() => {
                focusField(issue.field);
              }}
            >
              <span className="errorsummary-label">{issue.label}</span>
              <span className="errorsummary-message">{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}