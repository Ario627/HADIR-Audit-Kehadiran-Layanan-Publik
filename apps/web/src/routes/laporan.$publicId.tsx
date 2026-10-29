import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { ReportActions } from '../features/report/ReportActions';
import { ReportSummary } from '../features/report/ReportSummary';
import { ReportTimeline } from '../features/report/ReportTimeline';
import { describeError } from '../lib/errors';
import { prefetchAll } from '../lib/prefetch';
import { reportQuery } from '../lib/queries';
import { isOwnReport, readPublicId } from '../lib/report';

function ReportPage() {
  const { publicId } = Route.useParams();
  const valid = readPublicId(publicId);
  const query = useQuery({ ...reportQuery(publicId), enabled: valid !== null });

  if (valid === null) {
    return (
      <StatePanel tone="error" title="Alamat tidak valid">
        Nomor laporan pada alamat tidak sesuai format.
      </StatePanel>
    );
  }

  if (query.isPending) {
    return <StatePanel title="Memuat laporan">Mengambil status dan riwayat laporan.</StatePanel>;
  }

  if (query.isError) {
    const message = describeError(query.error);
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
              void query.refetch();
            }}
          >
            Coba lagi
          </button>
          <Link to="/" className="btn btn--ghost">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  const report = query.data;

  return (
    <>
      <ReportSummary report={report} isOwn={isOwnReport(report.publicId)} />
      <ReportActions report={report} />
      <ReportTimeline events={report.events} />

      <p className="note">
        Halaman ini publik. Teks laporan tampil, catatan internal instansi tidak; email pelapor tidak
        pernah dikirim ke server.
      </p>
    </>
  );
}

export const Route = createFileRoute('/laporan/$publicId')({
  loader: async ({ context, params }) => {
    if (readPublicId(params.publicId) === null) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(reportQuery(params.publicId)));
  },
  component: ReportPage,
});