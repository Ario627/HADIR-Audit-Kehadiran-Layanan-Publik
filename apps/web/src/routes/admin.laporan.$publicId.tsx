import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { AppealQueue } from '../features/admin/AppealQueue';
import { ModerationDecision } from '../features/admin/ModerationDecision';
import { PanelAdmin } from '../features/admin/PanelAdmin';
import { ResolutionVerify } from '../features/admin/ResolutionVerify';
import { moderationLabel, moderationTone } from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import { CaseTrackerSection } from '../features/report/CaseTracker';
import { StatePanel } from '../components/StatePanel';
import { fetchAdminReportDetail } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { categoryLabel, statusLabel } from '../lib/report';
import { formatDateTime } from '../lib/time';

const EVIDENCE_LABEL: Readonly<Record<string, string>> = {
  none: 'tanpa bukti',
  indication: 'indikasi',
  strong: 'kuat',
  field_verified: 'terverifikasi lapangan',
};

function AdminReportPage() {
  const { publicId } = Route.useParams();
  const profile = useAdminProfile();
  const detail = useQuery({
    queryKey: ['admin', 'detail', publicId],
    queryFn: () => fetchAdminReportDetail(publicId),
    staleTime: 20_000,
    retry: false,
  });

  const superadmin = profile.data?.role === 'superadmin';

  if (detail.isPending) {
    return <StatePanel title="Memuat laporan">Mengambil isi laporan dan status moderasinya.</StatePanel>;
  }

  if (detail.isError) {
    const message = describeError(detail.error);
    return (
      <>
        <StatePanel tone="error" title={message.title}>
          {message.detail}
        </StatePanel>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void detail.refetch();
            }}
          >
            Coba lagi
          </button>
          <Link to="/admin/moderasi" className="btn btn--ghost">
            Kembali ke antrean
          </Link>
        </div>
      </>
    );
  }

  const report = detail.data;

  return (
    <>
      <nav className="breadcrumb" aria-label="Remah roti">
        <ol className="breadcrumb-list">
          <li>
            <Link to="/admin">Ringkasan</Link>
          </li>
          <li>
            <Link to="/admin/moderasi">Moderasi</Link>
          </li>
          <li aria-current="page">{report.publicId}</li>
        </ol>
      </nav>

      <div className="page-head">
        <p className="label">
          {report.publicId} · {report.stopCode}
        </p>
        <h1 className="page-title">{categoryLabel(report.category)}</h1>
        <p className="page-lede">
          {report.stopName} · masuk {formatDateTime(report.createdAt)}
          {report.institutionName === null ? '' : ` · tujuan ${report.institutionName}`}
        </p>
      </div>

      <p className="chips">
        <span className={`chip chip--${moderationTone(report.moderation)}`}>
          moderasi {moderationLabel(report.moderation)}
        </span>
        <span className="chip chip--none">{statusLabel(report.status)}</span>
        <span className="chip chip--none">
          {EVIDENCE_LABEL[report.evidenceLevel] ?? report.evidenceLevel}
        </span>
        <span className="chip chip--none">skor bukti {report.evidenceScore.toFixed(2)}</span>
        <span className="chip chip--none">{String(report.corroborationCount)} dukungan</span>
      </p>

      <section className="console-panel" aria-labelledby="admin-report-text">
        <header className="console-panel-head">
          <h2 className="console-panel-title" id="admin-report-text">
            Isi laporan
          </h2>
        </header>
        <p className="prose">{report.text}</p>
      </section>

      <ModerationDecision report={report} />

      <CaseTrackerSection publicId={report.publicId} />

      {superadmin ? <PanelAdmin publicId={report.publicId} /> : null}
      {superadmin ? <ResolutionVerify publicId={report.publicId} /> : null}

      <AppealQueue canDecide={superadmin} publicId={report.publicId} />

      <div className="actions">
        <Link to="/admin/moderasi" className="btn btn--ghost">
          Kembali ke antrean
        </Link>
        {report.moderation === 'approved' ? (
          <Link
            to="/laporan/$publicId"
            params={{ publicId: report.publicId }}
            className="btn btn--ghost"
          >
            Lihat versi publik
          </Link>
        ) : null}
      </div>
    </>
  );
}

export const Route = createFileRoute('/admin/laporan/$publicId')({
  component: AdminReportPage,
});
