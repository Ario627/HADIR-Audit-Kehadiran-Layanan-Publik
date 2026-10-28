import type { Runway } from '@hadir/contracts';
import { safeExternalUrl } from '../../lib/safe-url';
import { daysRemainingText, horizonNote, tapeMarker, tapeTicks } from '../../lib/runway';

export interface RunwayTapeProps {
  fundedUntil: Runway['fundedUntil'];
  daysRemaining: Runway['daysRemaining'];
  sourceUrl: Runway['sourceUrl'];
}

export function RunwayTape({ fundedUntil, daysRemaining, sourceUrl }: RunwayTapeProps) {
  const marker = tapeMarker(daysRemaining);
  const source = safeExternalUrl(sourceUrl);

  return (
    <figure className="tape">
      <div className="tape-ruler" aria-hidden="true">
        <span className="tape-start" />
        {tapeTicks().map((tick) => (
          <span key={tick} className="tape-tick" style={{ left: `${tick}%` }} />
        ))}
        {marker === null ? null : <span className="tape-marker" style={{ left: `${marker}%` }} />}
      </div>
      <figcaption className="tape-caption">
        <span className="tape-value">{daysRemainingText(daysRemaining)}</span>
        <span className="tape-meta">
          {fundedUntil === null ? 'Batas pendanaan tidak dilaporkan' : `Batas dilaporkan ${fundedUntil}`}
          {source === null ? null : (
            <>
              {' · '}
              <a href={source} target="_blank" rel="noopener noreferrer">
                Sumber
                <span className="visually-hidden"> dokumen pendanaan, buka di tab baru</span>
              </a>
            </>
          )}
        </span>
        <span className="tape-meta">{horizonNote()}</span>
      </figcaption>
    </figure>
  );
}