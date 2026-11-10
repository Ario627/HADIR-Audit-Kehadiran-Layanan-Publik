import type { ReportListItem } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { apiGetChecked, withQuery } from '../../lib/api';
import { reportListSchema } from '../../lib/guards';
import { categoryLabel, statusLabel, statusTone } from '../../lib/report';
import { formatDate } from '../../lib/time';

const LEVEL_LABEL: Readonly<Record<string, string>> = {
  none: 'tanpa bukti',
  indication: 'indikasi',
  strong: 'kuat',
  field_verified: 'terverifikasi lapangan',
};

export function stopReportsQuery(stopId: string) {
  return {
    queryKey: ['reports', 'stop', stopId] as const,
    queryFn: async (): Promise<ReportListItem[]> =>
      (await apiGetChecked(withQuery('/v1/reports', { stopId, limit: 5 }), reportListSchema))
        .data,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
  };
}

export function StopReports({
  stopId,
  stopCode,
  stopName,
}: {
  stopId: string;
  stopCode: string;
  stopName: string;
}) {
  const query = useQuery(stopReportsQuery(stopId));

  return (
    <section className="stop-reports" aria-labelledby="stop-reports-title">
      <header className="stop-reports-head">
        <h2 id="stop-reports-title" className="stop-reports-title">
          Laporan warga di halte ini
        </h2>
        <Link className="dossier-link" to="/lapor" search={{ halte: stopCode }}>
          Tulis laporan
        </Link>
      </header>

      {query.isPending ? (
        <p className="dossier-sub dossier-sub--quiet">Memuat laporan.</p>
      ) : query.isError ? (
        <p className="dossier-sub dossier-sub--quiet">
          Daftar laporan belum bisa dimuat. Ini bukan berarti tidak ada masalah di {stopName}.
        </p>
      ) : query.data.length === 0 ? (
        <p className="dossier-sub dossier-sub--quiet">
          Belum ada laporan yang lolos moderasi. Kosong bukan berarti layanan di {stopName} baik.
        </p>
      ) : (
        <ul className="stop-reports-list">
          {query.data.map((report) => (
            <li key={report.publicId} className="stop-report">
              <Link
                className="stop-report-link"
                to="/laporan/$publicId"
                params={{ publicId: report.publicId }}
              >
                <span className="stop-report-category">{categoryLabel(report.category)}</span>
              </Link>
              <p className="stop-report-meta">
                <span className={`chip chip--${statusTone(report.status)}`}>
                  {statusLabel(report.status)}
                </span>
                <span className="stop-report-level">
                  {LEVEL_LABEL[report.evidenceLevel] ?? report.evidenceLevel}
                </span>
                <span className="stop-report-sep" aria-hidden="true">
                  ·
                </span>
                <span className="stop-report-level">{String(report.corroborationCount)} dukungan</span>
                <span className="stop-report-date">{formatDate(report.createdAt)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
