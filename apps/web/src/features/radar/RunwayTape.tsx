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
      <svg
        className="tape-ruler"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
      >
        <line
          className="tape-rail"
          x1="0"
          y1="50"
          x2="100"
          y2="50"
          vectorEffect="non-scaling-stroke"
        />
        {marker === null ? null : (
          <rect className="tape-fill" x="0" y="44" width={marker} height="12" />
        )}
        {tapeTicks().map((tick) => (
          <line
            key={tick}
            className="tape-tick"
            x1={tick}
            y1="32"
            x2={tick}
            y2="68"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <line
          className="tape-start"
          x1="0"
          y1="26"
          x2="0"
          y2="74"
          vectorEffect="non-scaling-stroke"
        />
        {marker === null ? null : (
          <line
            className="tape-marker"
            x1={marker}
            y1="6"
            x2={marker}
            y2="94"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
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