import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { describeError } from '../lib/errors';
import { isUuid } from '../lib/id';
import { prefetchAll } from '../lib/prefetch';
import { routeStopsQuery } from '../lib/queries';
import { formatMinutesShort } from '../lib/time';
import { safeExternalUrl } from '../lib/safe-url';

const MODE_LABELS = new Map([
  ['brt', 'BRT'],
  ['non_brt', 'Non-BRT'],
  ['feeder', 'Feeder'],
  ['other', 'Lainnya'],
]);

const STATUS_LABELS = new Map([
  ['active', 'Aktif'],
  ['suspended', 'Ditangguhkan'],
  ['stopped', 'Berhenti'],
  ['planned', 'Direncanakan'],
]);

function promiseText(peak: number | null, off: number | null): string {
  if (peak === null && off === null) {
    return 'Janji headway belum tercatat';
  }
  if (peak !== null && off !== null) {
    return `Puncak ${formatMinutesShort(peak)} · luar puncak ${formatMinutesShort(off)}`;
  }
  return formatMinutesShort(peak ?? off ?? 0);
}

function CorridorPage() {
  const { routeId } = Route.useParams();
  const validId = isUuid(routeId);
  const query = useQuery({ ...routeStopsQuery(routeId), enabled: validId });

  if (!validId) {
    return (
      <StatePanel tone="error" title="Alamat tidak valid">
        Nomor koridor pada alamat tidak sesuai format.
      </StatePanel>
    );
  }

  if (query.isPending) {
    return <StatePanel title="Memuat koridor">Mengambil daftar halte dan janji headway.</StatePanel>;
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

  const { route, stops } = query.data;
  const source = safeExternalUrl(route.headwaySourceUrl);
  const activeCount = stops.filter((stop) => stop.status === 'active').length;

  return (
    <>
      <div className="page-head">
        <p className="label">
          Koridor {route.code} · {MODE_LABELS.get(route.mode) ?? route.mode}
        </p>
        <h1 className="page-title">{route.name}</h1>
        <p className="page-lede">
          {STATUS_LABELS.get(route.status) ?? route.status} · {activeCount} dari {stops.length} halte
          aktif
        </p>
      </div>

      <dl className="ledger">
        <div>
          <dt>Janji puncak</dt>
          <dd>{route.promisedHeadwayPeakMin === null ? '—' : formatMinutesShort(route.promisedHeadwayPeakMin)}</dd>
        </div>
        <div>
          <dt>Janji luar puncak</dt>
          <dd>{route.promisedHeadwayOffMin === null ? '—' : formatMinutesShort(route.promisedHeadwayOffMin)}</dd>
        </div>
        <div>
          <dt>Berlaku</dt>
          <dd>
            {route.headwayValidFrom === null && route.headwayValidTo === null
              ? '—'
              : `${route.headwayValidFrom ?? '—'} → ${route.headwayValidTo ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt>Sumber janji</dt>
          <dd>
            {source === null ? (
              'Belum ada'
            ) : (
              <a href={source} target="_blank" rel="noopener noreferrer">
                Dokumen
                <span className="visually-hidden"> sumber janji headway, buka di tab baru</span>
              </a>
            )}
          </dd>
        </div>
      </dl>

      <p className="note">{promiseText(route.promisedHeadwayPeakMin, route.promisedHeadwayOffMin)}.</p>

      {stops.length === 0 ? (
        <StatePanel title="Belum ada halte terdaftar">
          Koridor ini belum punya urutan halte. Tanpa urutan, pengukuran per halte tidak bisa
          dibandingkan dengan janji headway.
        </StatePanel>
      ) : (
        <table className="board">
          <caption className="visually-hidden">Urutan halte pada koridor {route.code}</caption>
          <thead>
            <tr>
              <th scope="col">Urut</th>
              <th scope="col">Halte</th>
              <th scope="col">Arah</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((stop) => (
              <tr key={`${stop.stopId}-${stop.direction}-${stop.seq}`}>
                <td className="board-num">{stop.seq + 1}</td>
                <th scope="row" className="board-name">
                  <Link to="/s/$stopCode" params={{ stopCode: stop.stopCode }}>
                    {stop.stopName}
                  </Link>
                  <span className="board-meta">{stop.stopCode}</span>
                </th>
                <td className="board-meta">{stop.direction === 0 ? 'Pergi' : 'Pulang'}</td>
                <td>
                  <span className="level" data-level={stop.status === 'active' ? 'none' : 'indication'}>
                    {stop.status === 'active' ? 'Aktif' : 'Tidak aktif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="note">
        Angka tunggu per halte ditampilkan di halaman halte masing-masing, bukan di sini, agar setiap
        angka membawa jumlah sampel dan intervalnya sendiri.
      </p>
    </>
  );
}

export const Route = createFileRoute('/koridor/$routeId')({
  loader: async ({ context, params }) => {
    if (!isUuid(params.routeId)) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(routeStopsQuery(params.routeId)));
  },
  component: CorridorPage,
});