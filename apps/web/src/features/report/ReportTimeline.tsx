import type { ReportDetail } from '@hadir/contracts';
import { eventLabel } from '../../lib/report';
import { formatDateTime } from '../../lib/time';

export interface ReportTimelineProps {
  events: ReportDetail['events'];
}

const ACTOR_LABELS = new Map<ReportDetail['events'][number]['actorType'], string>([
  ['citizen', 'Warga'],
  ['partner', 'Instansi'],
  ['system', 'Sistem'],
  ['moderator', 'Moderator'],
]);

export function ReportTimeline({ events }: ReportTimelineProps) {
  if (events.length === 0) {
    return <p className="note">Belum ada riwayat untuk laporan ini.</p>;
  }

  return (
    <section className="timeline" aria-labelledby="timeline-heading">
      <h2 className="label" id="timeline-heading">
        Riwayat
      </h2>
      <ol className="timeline-list">
        {events.map((event, index) => (
          <li key={`${event.kind}-${event.createdAt}-${index}`} className="timeline-item">
            <p className="timeline-title">{eventLabel(event.kind)}</p>
            <p className="timeline-meta">
              {ACTOR_LABELS.get(event.actorType) ?? 'Sistem'} · {formatDateTime(event.createdAt)}
            </p>
            {event.note === null ? null : <p className="timeline-note">{event.note}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}