import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { ActionPanel } from '../features/partner/ActionPanel';
import { PartnerReportBody } from '../features/partner/PartnerReportBody';
import { usePartnerProfile } from '../features/partner/use-partner';
import { describeError, isNotFound } from '../lib/errors';
import { partnerReportQuery } from '../lib/partner-api';

const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{6,40}$/;
const ACTING_ROLES = new Set(['responder', 'admin']);

function readPublicId(raw: unknown): string | null {
  return typeof raw === 'string' && PUBLIC_ID_PATTERN.test(raw) ? raw : null;
}

function PartnerReportPage() {
  const params = Route.useParams();
  const publicId = readPublicId(params.publicId);
  const profile = usePartnerProfile();
  const report = useQuery({ ...partnerReportQuery(publicId ?? ''), enabled: publicId !== null });
  const now = Date.now();

  if (publicId === null) {
    return (
      <>
        <div className="page-head">
          <p className="label">Alamat tidak valid</p>
          <h1 className="page-title">ID laporan ini tidak dikenali</h1>
          <p className="page-lede">
            ID laporan terdiri dari huruf dan angka. Buka inbox untuk memilih laporan dari daftar.
          </p>
        </div>
        <div className="actions">
          <Link to="/partner/laporan" className="btn">
            Buka inbox
          </Link>
        </div>
      </>
    );
  }

  if (report.isPending) {
    return <StatePanel title="Memuat laporan">Mengambil isi laporan dan riwayatnya.</StatePanel>;
  }

  if (report.isError) {
    if (isNotFound(report.error)) {
      return (
        <>
          <StatePanel title="Laporan tidak ditemukan">
            Laporan ini tidak ada di instansimu. Kalau kamu yakin ada, pastikan akunmu memakai instansi
            yang benar.
          </StatePanel>
          <div className="actions">
            <Link to="/partner/laporan" className="btn">
              Buka inbox
            </Link>
          </div>
        </>
      );
    }
    const message = describeError(report.error);
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
              void report.refetch();
            }}
          >
            Coba lagi
          </button>
          <Link to="/partner/laporan" className="btn btn--ghost">
            Buka inbox
          </Link>
        </div>
      </>
    );
  }

  if (report.data === undefined) {
    return (
      <StatePanel tone="error" title="Laporan tidak bisa ditampilkan">
        Data laporan tidak lolos pemeriksaan bentuk, jadi tidak ditampilkan.
      </StatePanel>
    );
  }

  const canAct = profile.data === undefined ? false : ACTING_ROLES.has(profile.data.role);

  return (
    <>
      <nav className="breadcrumb" aria-label="Remah roti">
        <ol className="breadcrumb-list">
          <li>
            <Link to="/partner">Ringkasan</Link>
          </li>
          <li>
            <Link to="/partner/laporan">Laporan</Link>
          </li>
          <li aria-current="page">{publicId}</li>
        </ol>
      </nav>

      <div className="actions">
        <Link to="/partner/laporan" className="btn btn--ghost">
          Kembali ke inbox
        </Link>
        <Link to="/laporan/$publicId" params={{ publicId }} className="btn btn--ghost">
          Lihat versi publik
        </Link>
      </div>

      <PartnerReportBody report={report.data} now={now} />
      <ActionPanel publicId={publicId} canAct={canAct} now={now} />
    </>
  );
}

export const Route = createFileRoute('/partner/laporan/$publicId')({
  component: PartnerReportPage,
});