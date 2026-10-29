import type { PartnerAnalytics, ReportCategory, ReportStatus } from '@hadir/contracts';
import { bucketNote, medianNote, rateNote, totalNote } from '../../lib/analytics';
import { bucketCountText, hoursText, ratioText } from '../../lib/partner';
import { categoryLabel, statusLabel } from '../../lib/report';
import { formatNumber } from '../../lib/time';

export interface AnalyticsPanelProps {
  analytics: PartnerAnalytics;
}

function BucketList({
  title,
  buckets,
  labelOf,
}: {
  title: string;
  buckets: PartnerAnalytics['byStatus'];
  labelOf: (key: string) => string;
}) {
  return (
    <section className="settings-block" aria-label={title}>
      <h2 className="section-title">{title}</h2>
      <ul className="bucketlist">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="bucketlist-item">
            <span>{labelOf(bucket.key)}</span>
            <span className="bucketlist-count">{bucketCountText(bucket)}</span>
          </li>
        ))}
      </ul>
      {bucketNote(buckets) === null ? null : <p className="settings-meta">{bucketNote(buckets)}</p>}
    </section>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string | null }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="measured-number">{value}</dd>
      {note === null ? null : <dd className="settings-meta">{note}</dd>}
    </div>
  );
}

export function AnalyticsPanel({ analytics }: AnalyticsPanelProps) {
  const suppressed = analytics.totalSuppressed;
  const total = analytics.totalReports;
  const medianSuppressed = medianNote(total, suppressed);
  const ratioSuppressed = rateNote(total, suppressed);

  return (
    <>
      <dl className="ledger">
        <Metric
          label="Total laporan"
          value={suppressed || total === null ? 'disembunyikan' : formatNumber(total, 0)}
          note={totalNote(total, suppressed)}
        />
        <Metric
          label="Median tanggapan pertama"
          value={medianSuppressed === null ? hoursText(analytics.medianFirstResponseHours) : '—'}
          note={medianSuppressed}
        />
        <Metric
          label="Median waktu selesai"
          value={medianSuppressed === null ? hoursText(analytics.medianResolutionHours) : '—'}
          note={medianSuppressed}
        />
        <Metric
          label="Diklaim selesai"
          value={ratioSuppressed === null ? ratioText(analytics.claimedResolvedRate) : '—'}
          note={ratioSuppressed}
        />
        <Metric
          label="Dibantah warga"
          value={ratioSuppressed === null ? ratioText(analytics.disputedRate) : '—'}
          note={ratioSuppressed}
        />
        <Metric
          label="Laporan dengan dukungan"
          value={ratioSuppressed === null ? ratioText(analytics.corroborationRate) : '—'}
          note={ratioSuppressed}
        />
      </dl>

      <p className="note">
        Ambang kerahasiaan: kelompok dengan kurang dari {analytics.kThreshold} laporan disembunyikan, dan
        median baru dihitung setelah ada cukup sampel. Ini melindungi warga di kota kecil yang laporannya
        mungkin satu-satunya pada kategori tertentu.
      </p>

      <div className="analytics-pair">
        <BucketList
          title="Per status"
          buckets={analytics.byStatus}
          labelOf={(key) => statusLabel(key as ReportStatus)}
        />
        <BucketList
          title="Per kategori"
          buckets={analytics.byCategory}
          labelOf={(key) => labelForCategory(key)}
        />
      </div>
    </>
  );
}

const CATEGORY_KEYS = new Set<string>([
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
]);

function labelForCategory(key: string): string {
  return CATEGORY_KEYS.has(key) ? categoryLabel(key as ReportCategory) : key;
}