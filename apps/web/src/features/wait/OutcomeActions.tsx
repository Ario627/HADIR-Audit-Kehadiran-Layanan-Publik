import { useEffect, useRef, useState } from 'react';
import { END_OUTCOMES, outcomeCopy, type EndOutcome, type OutcomeCopy } from '../../lib/episode';

export interface OutcomeActionsProps {
  busyOutcome: EndOutcome | null;
  disabled: boolean;
  onSelect: (outcome: EndOutcome) => void;
}

function toneClass(copy: OutcomeCopy): string {
  if (copy.tone === 'primary') {
    return 'btn';
  }
  if (copy.tone === 'danger') {
    return 'btn btn--danger';
  }
  return 'btn btn--ghost';
}

export function OutcomeActions({ busyOutcome, disabled, onSelect }: OutcomeActionsProps) {
  const [pending, setPending] = useState<EndOutcome | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (pending !== null) {
      confirmRef.current?.focus();
    }
  }, [pending]);

  function cancel(): void {
    setPending(null);
    triggerRef.current?.focus();
  }

  if (pending !== null) {
    const copy = outcomeCopy(pending);
    return (
      <div className="confirm">
        <p className="confirm-text" id="confirm-question">
          {copy.question}
        </p>
        <div className="confirm-actions">
          <button
            ref={confirmRef}
            type="button"
            className={toneClass(copy)}
            disabled={disabled}
            aria-describedby="confirm-question"
            onClick={() => {
              setPending(null);
              onSelect(pending);
            }}
          >
            {busyOutcome === pending ? 'Menyimpan…' : copy.confirm}
          </button>
          <button type="button" className="btn btn--ghost" onClick={cancel} disabled={disabled}>
            Batal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ticket-actions">
      {END_OUTCOMES.map((outcome) => {
        const copy = outcomeCopy(outcome);
        return (
          <button
            key={outcome}
            type="button"
            className={toneClass(copy)}
            disabled={disabled}
            onClick={(event) => {
              triggerRef.current = event.currentTarget;
              setPending(outcome);
            }}
          >
            {copy.label}
          </button>
        );
      })}
      <button
        type="button"
        className="link-button"
        disabled={disabled}
        onClick={(event) => {
          triggerRef.current = event.currentTarget;
          setPending('cancelled');
        }}
      >
        {outcomeCopy('cancelled').label}
      </button>
    </div>
  );
}