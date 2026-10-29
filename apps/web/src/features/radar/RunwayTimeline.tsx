import type { RunwayEvent } from '@hadir/contracts';
import { safeExternalUrl } from '../../lib/safe-url';
import { eventKindLabel, sortedEvents } from '../../lib/runway';
import { formatDate } from '../../lib/time';

export interface RunwayTimelineProps {
  events: readonly RunwayEvent[];
}

export function RunwayTimeline({ events }: RunwayTimelineProps) {
  const ordered = sortedEvents(events);

  if (ordered.length === 0) {
    return <p className="note">Belum ada peristiwa pendanaan yang tercatat.</p>;
  }

  return (
    <section className="timeline" aria-labelledby="runway-timeline-heading">
      <h2 className="label" id="runway-timeline-heading">
        Riwayat keputusan
      </h2>
      <ol className="timeline-list">
        {ordered.map((event) => {
          const source = safeExternalUrl(event.sourceUrl);
          return (
            <li key={event.seq} className="timeline-item">
              <p className="timeline-title">{eventKindLabel(event.kind)}</p>
              <p className="timeline-meta">
                {formatDate(event.occurredAt)}
                {source === null ? null : (
                  <>
                    {' · '}
                    <a href={source} target="_blank" rel="noopener noreferrer">
                      Sumber
                      <span className="visually-hidden"> untuk peristiwa ini, buka di tab baru</span>
                    </a>
                  </>
                )}
              </p>
              <p className="timeline-note">{event.note}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}