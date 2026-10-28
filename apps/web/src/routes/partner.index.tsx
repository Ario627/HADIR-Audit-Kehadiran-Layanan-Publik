import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { InboxList } from '../features/partner/InboxList';
import { analyticsQuery, recentInboxQuery } from '../lib/partner-api';
import { bucketCountText, hoursText, ratioText } from '../lib/partner';
import { describeError } from '../lib/errors';
import { formatNumber } from '../lib/time';

function PartnerSummaryPage() {
  const analytics = useQuery(analyticsQuery());
  const recent = useQuery(recentInboxQuery());

  if (analytics.isPending) {
    return <StatePanel title="Menghitung ringkasan">Mengambil agregat laporan instansimu.</StatePanel>;
  }

  if (analytics.isError) {
    const message = describeError(analytics.error);
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
              void analytics.refetch();
            }}
          >
            Coba lagi
          </button>
        </div>
      </>
    );
  }

  const data = analytics.data;
  const total =
    data.totalSuppressed || data.totalReports === null
      ? 'disembunyikan'
      : formatNumber(data.totalReports, 0);

  return (
    <>
      <div className="page-head">
        <p className="label">Ringkasan</p>
        <h1 className="page-title">Beban laporan instansimu</h1>
        <p className="page-lede">
          Angka dihitung dari {data.window.days} hari terakhir. Kelompok yang jumlahnya di bawah{' '}
          {data.kThreshold} laporan disembunyikan supaya tidak bisa dipakai menebak laporan individu.
        </p>
      </div>

      <dl className="ledger">
        <div>
          <dt>Total laporan</dt>
          <dd className="measured-number">{total}</dd>
        </div>
        <div>
          <dt>Median tanggapan pertama</dt>
          <dd className="measured-number">{hoursText(data.medianFirstResponseHours)}</dd>
        </div>
        <div>
          <dt>Diklaim selesai</dt>
          <dd className="measured-number">{ratioText(data.claimedResolvedRate)}</dd>
        </div>
        <div>
          <dt>Dibantah warga</dt>
          <dd className="measured-number">{ratioText(data.disputedRate)}</dd>
        </div>
      </dl>

      <section aria-labelledby="summary-status-title">
        <h2 className="section-title" id="summary-status-title">
          Sebaran status
        </h2>
        <ul className="bucketlist">
          {data.byStatus.map((bucket) => (
            <li key={bucket.key} className="bucketlist-item">
              <span>{bucket.key}</span>
              <span className="bucketlist-count">{bucketCountText(bucket)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="summary-recent-title">
        <h2 className="section-title" id="summary-recent-title">
          Lima laporan terbaru
        </h2>
        {recent.isPending ? (
          <p className="note">Mengambil laporan terbaru.</p>
        ) : recent.isError ? (
          <p className="note">{describeError(recent.error).detail}</p>
        ) : recent.data.items.length === 0 ? (
          <p className="note">Belum ada laporan yang masuk ke instansimu.</p>
        ) : (
          <InboxList items={recent.data.items} />
        )}
        <div className="actions">
          <Link to="/partner/laporan" className="btn btn--ghost">
            Buka seluruh laporan
          </Link>
          <Link to="/partner/analitik" className="btn btn--ghost">
            Analitik per rentang
          </Link>
          <Link to="/partner/ekspor" className="btn btn--ghost">
            Buat ekspor
          </Link>
        </div>
      </section>
    </>
  );
}

export const Route = createFileRoute('/partner/')({
  component: PartnerSummaryPage,
});