import type { PartnerReportDetail } from '@hadir/contracts';
import { apiAssetUrl } from '../../lib/api';
import { evidenceOf } from '../../lib/evidence';
import { followUpText } from '../../lib/partner';
import { categoryLabel, eventLabel, moderationLabel, statusLabel } from '../../lib/report';
import { formatDateTime, formatNumber } from '../../lib/time';

export interface PartnerReportBodyProps {
  report: PartnerReportDetail;
  now: number;
}

function MediaStrip({ report }: { report: PartnerReportDetail }) {
  const usable = report.media.filter((item) => item.status !== 'rejected');
  if (usable.length === 0) {
    return <p className="note">Tidak ada lampiran foto pada laporan ini.</p>;
  }
  return (
    <ul className="partner-media">
      {usable.map((item) => {
        const src = apiAssetUrl(item.url);
        return (
          <li key={item.mediaId} className="partner-media-item">
            {src === null ? (
              <p className="note">Lampiran tidak bisa ditampilkan.</p>
            ) : (
              <img
                src={src}
                alt={`Lampiran laporan ${report.publicId}`}
                width={item.width ?? 480}
                height={item.height ?? 360}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
              />
            )}
            <span className="partner-media-meta">
              {item.status === 'approved' ? 'Lolos moderasi' : 'Menunggu moderasi'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function PartnerReportBody({ report, now }: PartnerReportBodyProps) {
  const followUp = followUpText(report.followUpAt, now);
  return (
    <div className="partner-report">
      <div className="page-head">
        <p className="label">
          {report.publicId} · {report.stopCode}
        </p>
        <h1 className="page-title">{categoryLabel(report.category)}</h1>
        <p className="page-lede">
          {report.stopName} · masuk {formatDateTime(report.createdAt)}
        </p>
      </div>

      <dl className="facts">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(report.status)}</dd>
        </div>
        <div>
          <dt>Level bukti</dt>
          <dd>{evidenceOf(report.evidenceLevel).label}</dd>
        </div>
        <div>
          <dt>Moderasi</dt>
          <dd>{moderationLabel(report.moderation)}</dd>
        </div>
        <div>
          <dt>Dukungan warga</dt>
          <dd>{formatNumber(report.corroborationCount, 0)}</dd>
        </div>
        <div>
          <dt>Skor bukti</dt>
          <dd>{formatNumber(report.evidenceScore, 2)}</dd>
        </div>
        <div>
          <dt>Tindak lanjut</dt>
          <dd>{followUp ?? 'Belum dijadwalkan'}</dd>
        </div>
        {report.authorityName === null ? null : (
          <div>
            <dt>Instansi penanggung jawab</dt>
            <dd>{report.authorityName}</dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="partner-text-title">
        <h2 className="section-title" id="partner-text-title">
          Isi laporan
        </h2>
        <p className="prose">{report.text}</p>
      </section>

      <section aria-labelledby="partner-media-title">
        <h2 className="section-title" id="partner-media-title">
          Lampiran
        </h2>
        <MediaStrip report={report} />
      </section>

      <section aria-labelledby="partner-timeline-title">
        <h2 className="section-title" id="partner-timeline-title">
          Riwayat
        </h2>
        <ol className="timeline-list">
          {report.events.map((event, index) => (
            <li key={`${event.kind}-${event.createdAt}-${index}`} className="timeline-item">
              <p className="timeline-title">{eventLabel(event.kind)}</p>
              <p className="timeline-meta">
                {formatDateTime(event.createdAt)} ·{' '}
                {event.actorType === 'citizen'
                  ? 'Warga'
                  : event.actorType === 'partner'
                    ? 'Instansi'
                    : event.actorType === 'moderator'
                      ? 'Moderator'
                      : 'Sistem'}
              </p>
              {event.note === null ? null : <p className="timeline-note">{event.note}</p>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}