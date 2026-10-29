import type { ReportDetail } from '@hadir/contracts';
import { categoryLabel, moderationLabel, statusLabel, statusTone } from '../../lib/report';
import { formatDateTime } from '../../lib/time';

export interface ReportSummaryProps {
  report: ReportDetail;
  isOwn: boolean;
}

export function ReportSummary({ report, isOwn }: ReportSummaryProps) {
  return (
    <>
      <div className="page-head">
        <p className="label">
          Laporan {report.publicId} · {categoryLabel(report.category)}
        </p>
        <h1 className="page-title">{report.stopName}</h1>
        <p className="page-lede">
          {report.stopCode} · dikirim {formatDateTime(report.createdAt)}
          {report.authorityName === null ? '' : ` · tujuan ${report.authorityName}`}
        </p>
      </div>

      <div className="report-status" data-tone={statusTone(report.status)}>
        <p className="report-status-label">{statusLabel(report.status)}</p>
        <p className="report-status-meta">
          {report.corroborationCount} dukungan warga
          {isOwn ? ' · ini laporanmu' : ''}
        </p>
        <p className="report-status-meta">{moderationLabel(report.moderation)}</p>
      </div>

      <div className="report-text">
        {report.text.split('\n').map((line, index) => (
          <p key={`${index}-${line.length}`}>{line}</p>
        ))}
      </div>
    </>
  );
}