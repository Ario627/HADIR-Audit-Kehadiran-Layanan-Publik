import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { BoardLedger } from '../features/board/BoardLedger';
import { ScanBar } from '../features/board/ScanBar';
import { StopBoard } from '../features/board/StopBoard';
import { StopFilter } from '../features/board/StopFilter';
import { MapPlot } from '../features/map/MapPlot';
import { NewsBoard } from '../features/news/NewsBoard';
import {
  buildRows,
  readFilter,
  readPeriod,
  summarizeRows,
  toSearchParams,
  viewRows,
  type BoardSearchParams,
} from '../lib/board';
import { evidenceOf } from '../lib/evidence';
import { mapPointsOf } from '../lib/map';
import { prefetchAll } from '../lib/prefetch';
import { activeEpisodeQuery, coverageSummaryQuery, stopsQuery } from '../lib/queries';
import { formatNumber } from '../lib/time';
import { useResumeRedirect } from '../lib/use-resume';

const STOP_LIMIT = 100;

function BoardPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const routerNavigate = useNavigate();
  const location = useLocation();
  const filter = readFilter(search);
  const stops = useQuery(stopsQuery({ q: '', limit: STOP_LIMIT }));
  const coverage = useQuery(coverageSummaryQuery(filter.period));
  const active = useQuery(activeEpisodeQuery());

  const resume = useCallback(
    (episodeId: string) => {
      void routerNavigate({ to: '/wait/$episodeId', params: { episodeId } });
    },
    [routerNavigate],
  );

  useResumeRedirect(active.data?.episode?.id ?? null, location.pathname, resume);

  const board = useMemo(() => {
    if (stops.data === undefined || coverage.data === undefined) {
      return null;
    }
    const rows = buildRows(stops.data.items, coverage.data.stops);
    return {
      totals: summarizeRows(rows),
      visible: viewRows(rows, filter),
      hasMore: stops.data.hasMore,
      points: mapPointsOf(stops.data.items, rows),
    };
  }, [stops.data, coverage.data, filter.q, filter.sort, filter.level]);

  const [mapSelection, setMapSelection] = useState<string | null>(null);
  const [hoveredStop, setHoveredStop] = useState<string | null>(null);

  const selectedPoint =
    mapSelection === null || board === null
      ? null
      : (board.points.find((point) => point.id === mapSelection) ?? null);

  const failed = stops.isError || coverage.isError;

  return (
    <>
      <div className="deck">
        <div className="deck-lead">
          <p className="label">Papan · 7 hari terakhir</p>
          <h1 className="page-title">Berapa lama orang benar-benar menunggu</h1>
          <p className="page-lede">
            Angka di papan ini berasal dari episode tunggu yang dicatat warga di halte terdaftar.
            Halte tanpa data dibiarkan kosong, bukan diisi nol.
          </p>
        </div>
        <div className="deck-act">
          <ScanBar />
        </div>
      </div>

      {failed ? (
        <StatePanel tone="error" title="Papan bukti tidak bisa dimuat">
          Periksa koneksi lalu muat ulang halaman. Data yang sudah pernah dimuat tetap tersedia setelah
          koneksi kembali.
        </StatePanel>
      ) : null}

      {board === null ? (
        failed ? null : (
          <StatePanel title="Memuat papan bukti">Mengambil daftar halte dan cakupan data.</StatePanel>
        )
      ) : (
        <>
          <BoardLedger totals={board.totals} period={filter.period} />

          <section className="stops" aria-labelledby="stops-heading">
            <div className="stops-head">
              <h2 className="section-title" id="stops-heading">
                Halte dan bukti
              </h2>
              <p className="stops-count">
                {formatNumber(board.visible.length, 0)} dari {formatNumber(board.totals.listed, 0)}{' '}
                halte
              </p>
            </div>

            <StopFilter
              value={filter}
              onApply={(next) => {
                void navigate({ search: toSearchParams(next) });
              }}
            />

            <div className="stops-split">
              <div className="stops-table">
                {board.visible.length === 0 ? (
                  <StatePanel title="Tidak ada halte yang cocok">
                    Ubah kata kunci atau level bukti. Ringkasan di atas tetap menghitung seluruh halte
                    terdaftar.
                  </StatePanel>
                ) : (
                  <StopBoard
                    rows={board.visible}
                    highlightedId={hoveredStop ?? mapSelection}
                    onHighlight={(stopId) => {
                      setHoveredStop(stopId);
                    }}
                  />
                )}
                {board.hasMore ? (
                  <p className="note">
                    Papan memuat {STOP_LIMIT} halte pertama. Saringan di atas hanya berlaku untuk
                    halte yang sudah dimuat, bukan seluruh basis data.
                  </p>
                ) : null}
              </div>

              <aside className="stops-map" aria-labelledby="stops-map-title">
                <div className="stops-map-head">
                  <h2 className="label" id="stops-map-title">
                    Sebaran
                  </h2>
                  <Link to="/peta" className="linkbtn">
                    Peta penuh
                  </Link>
                </div>
                <div className="stops-map-frame">
                  {board.points.length === 0 ? (
                    <p className="note">Belum ada halte berkoordinat untuk digambar.</p>
                  ) : (
                    <MapPlot
                      points={board.points}
                      selectedId={hoveredStop ?? mapSelection}
                      variant="compact"
                      labelMode="focus"
                      onSelect={(id) => {
                        setMapSelection((current) => (current === id ? null : id));
                      }}
                    />
                  )}
                </div>
                {selectedPoint === null ? (
                  <p className="note stops-map-hint">Ketuk titik untuk membuka halte terkait.</p>
                ) : (
                  <p className="stops-map-pick">
                    <Link to="/s/$stopCode" params={{ stopCode: selectedPoint.code }}>
                      {selectedPoint.code} · {selectedPoint.name}
                    </Link>
                    <span className="board-meta">
                      {evidenceOf(selectedPoint.level).label} ·{' '}
                      {formatNumber(selectedPoint.episodes, 0)} episode
                    </span>
                  </p>
                )}
              </aside>
            </div>
          </section>
        </>
      )}

      <NewsBoard />
    </>
  );
}

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): BoardSearchParams =>
    toSearchParams(readFilter(raw)),
  loaderDeps: ({ search }) => ({ period: readPeriod(search.period) }),
  loader: async ({ context, deps }) => {
    await prefetchAll(
      context.queryClient.ensureQueryData(stopsQuery({ q: '', limit: STOP_LIMIT })),
      context.queryClient.ensureQueryData(coverageSummaryQuery(deps.period)),
    );
  },
  component: BoardPage,
});