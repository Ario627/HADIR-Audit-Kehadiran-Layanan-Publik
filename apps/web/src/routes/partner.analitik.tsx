import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { AnalyticsPanel } from '../features/partner/AnalyticsPanel';
import { WindowPicker } from '../features/partner/WindowPicker';
import { MAX_WINDOW_DAYS, windowSpanNote } from '../lib/analytics';
import {
  MAX_RANGE_DAYS,
  rangeIssues,
  readRange,
  toIsoRange,
  toRangeSearch,
  todayDay,
  type DateRange,
  type RangePreset,
} from '../lib/date-range';
import { describeError } from '../lib/errors';
import { analyticsQuery } from '../lib/partner-api';

export interface AnalitikSearch {
  rentang?: string;
  dari?: string;
  sampai?: string;
}

function AnalitikPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const now = Date.now();
  const today = todayDay(now);
  const selection = readRange(search, now);
  const issue = rangeIssues(selection.range, now, MAX_RANGE_DAYS);
  const iso = toIsoRange(selection.range);

  const analytics = useQuery({
    ...analyticsQuery(iso),
    enabled: issue === null,
  });

  const apply = (next: { preset: RangePreset; range: DateRange }): void => {
    void navigate({ to: '/partner/analitik', search: toRangeSearch(next) });
  };

  const requestedDays =
    issue === null && selection.range.from !== '' && selection.range.to !== ''
      ? Math.round(
          (Date.parse(`${selection.range.to}T00:00:00Z`) -
            Date.parse(`${selection.range.from}T00:00:00Z`)) /
            86_400_000,
        ) + 1
      : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Analitik</p>
        <h1 className="page-title">Agregat laporan instansimu</h1>
        <p className="page-lede">
          Semua angka di halaman ini dihitung dari laporan yang masuk ke instansimu saja. Kelompok kecil
          disembunyikan supaya tidak bisa dipakai menebak laporan individu.
        </p>
      </div>

      <WindowPicker
        preset={selection.preset}
        range={selection.range}
        issue={issue}
        today={today}
        maxDays={MAX_RANGE_DAYS}
        onChange={apply}
      />

      {issue === null ? null : (
        <p className="note">
          Perbaiki rentang tanggal di atas untuk memuat agregat. Selama rentang belum sah, permintaan
          tidak dikirim ke server.
        </p>
      )}

      {analytics.isPending ? (
        <StatePanel title="Menghitung agregat">Mengambil ringkasan laporan pada rentang ini.</StatePanel>
      ) : analytics.isError ? (
        <>
          <StatePanel tone="error" title={describeError(analytics.error).title}>
            {describeError(analytics.error).detail}
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
      ) : analytics.data === undefined ? (
        <StatePanel tone="error" title="Agregat tidak bisa ditampilkan">
          Data agregat tidak lolos pemeriksaan bentuk, jadi tidak ditampilkan.
        </StatePanel>
      ) : (
        <>
          <p className="settings-meta">
            Jendela {analytics.data.window.start.slice(0, 10)} sampai{' '}
            {analytics.data.window.end.slice(0, 10)} ({analytics.data.window.days} hari). Dihitung{' '}
            {analytics.data.generatedAt.slice(11, 16)} UTC.
          </p>
          {windowSpanNote(analytics.data, requestedDays) === null ? null : (
            <p className="note">{windowSpanNote(analytics.data, requestedDays)}</p>
          )}
          <AnalyticsPanel analytics={analytics.data} />
        </>
      )}

      <p className="note">
        Cakupan per koridor tidak tersedia dari endpoint mitra. Angka cakupan publik ada di halaman papan
        bukti, dan sengaja tidak dicampur ke sini agar mitra tidak menyimpulkan cakupan wilayah dari data
        yang hanya milik instansinya. Batas rentang {MAX_WINDOW_DAYS} hari mengikuti batas server.
      </p>
    </>
  );
}

export const Route = createFileRoute('/partner/analitik')({
  validateSearch: (raw: Record<string, unknown>): AnalitikSearch =>
    toRangeSearch(readRange(raw, Date.now())),
  component: AnalitikPage,
});