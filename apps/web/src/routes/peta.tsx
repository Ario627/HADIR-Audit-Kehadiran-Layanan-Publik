import type { CoveragePeriod } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { StatePanel } from '../components/StatePanel';
import { MapLegend } from '../features/map/MapLegend';
import { MapPlot } from '../features/map/MapPlot';
import { StopSheet } from '../features/map/StopSheet';
import { buildRows, readPeriod } from '../lib/board';
import { evidenceOf } from '../lib/evidence';
import { mapPointsOf } from '../lib/map';
import { prefetchAll } from '../lib/prefetch';
import { readStopCode } from '../lib/qr';
import { coverageSummaryQuery, stopsQuery } from '../lib/queries';
import { formatNumber } from '../lib/time';

export interface PetaSearch {
  halte?: string;
  periode?: CoveragePeriod;
}

const STOP_LIMIT = 100;

function readPetaSearch(raw: Record<string, unknown>): PetaSearch {
  const output: PetaSearch = {};
  const stopCode = readStopCode(raw.halte);
  if (stopCode !== null) {
    output.halte = stopCode;
  }
  if (raw.periode === '30d' || raw.periode === '7d') {
    output.periode = raw.periode;
  }
  return output;
}

function PetaPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const period = readPeriod(search.periode);
  const selectedCode = readStopCode(search.halte);

  const stops = useQuery(stopsQuery({ q: '', limit: STOP_LIMIT }));
  const coverage = useQuery(coverageSummaryQuery(period));

  const rows = useMemo(() => {
    if (stops.data === undefined || coverage.data === undefined) {
      return null;
    }
    return buildRows(stops.data.items, coverage.data.stops);
  }, [stops.data, coverage.data]);

  const points = useMemo(() => {
    if (stops.data === undefined || rows === null) {
      return [];
    }
    return mapPointsOf(stops.data.items, rows);
  }, [stops.data, rows]);

  const selectedPoint = useMemo(() => {
    if (selectedCode === null) {
      return null;
    }
    return points.find((point) => point.code === selectedCode) ?? null;
  }, [points, selectedCode]);

  const selectedId = selectedPoint === null ? null : selectedPoint.id;

  const select = (id: string): void => {
    const point = points.find((entry) => entry.id === id);
    if (point === undefined) {
      return;
    }
    void navigate({
      to: '/peta',
      search: {
        halte: point.code,
        ...(period === '30d' ? { periode: period } : {}),
      },
    });
  };

  const clearSelection = (): void => {
    void navigate({
      to: '/peta',
      search: period === '30d' ? { periode: period } : {},
    });
  };

  const failed = stops.isError || coverage.isError;
  const sorted = useMemo(
    () =>
      [...points].sort(
        (left, right) => right.episodes - left.episodes || left.code.localeCompare(right.code, 'id'),
      ),
    [points],
  );

  return (
    <>
      <div className="page-head">
        <p className="label">Peta</p>
        <h1 className="page-title">Di mana halte ini berada</h1>
        <p className="page-lede">
          Skema posisi halte terdaftar beserta level bukti yang sudah tercatat. Bidang ini digambar dari
          koordinat halte; tidak ada ubin peta pihak ketiga, jadi tidak ada permintaan keluar sama sekali.
        </p>
      </div>

      {failed ? (
        <StatePanel tone="error" title="Peta tidak bisa dimuat">
          Data halte atau cakupan gagal diambil. Daftar halte di papan bukti tetap bisa dipakai.
        </StatePanel>
      ) : null}

      {stops.isPending || rows === null ? (
        <StatePanel title="Menyiapkan peta">Mengambil koordinat halte dan cakupan data.</StatePanel>
      ) : points.length === 0 ? (
        <StatePanel title="Belum ada halte berkoordinat">
          Tidak ada halte terdaftar yang bisa digambar. Buka papan bukti untuk daftar lengkap.
        </StatePanel>
      ) : (
        <>
          <MapLegend points={points} />
          <MapPlot points={points} selectedId={selectedId} onSelect={select} />
          {selectedPoint === null ? (
            <p className="note">
              Pilih titik untuk melihat ringkasan halte. Daftar tabel lengkap ada di{' '}
              <Link to="/">papan bukti</Link>.
            </p>
          ) : (
            <StopSheet point={selectedPoint} onClose={clearSelection} />
          )}

          <section className="mapfallback" aria-labelledby="mapfallback-title">
            <h2 className="section-title" id="mapfallback-title">
              Sebagai daftar
            </h2>
            <ol className="maplist">
              {sorted.map((point) => (
                <li key={point.id} className="maplist-item">
                  <Link
                    to="/peta"
                    search={{ halte: point.code, ...(period === '30d' ? { periode: period } : {}) }}
                  >
                    {point.code} · {point.name}
                  </Link>
                  <span className="maplist-meta">
                    {evidenceOf(point.level).label} ·{' '}
                    {point.episodes === 0
                      ? 'belum ada episode'
                      : `${formatNumber(point.episodes, 0)} episode`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/peta')({
  validateSearch: (raw: Record<string, unknown>): PetaSearch => readPetaSearch(raw),
  loaderDeps: ({ search }) => ({ period: readPeriod(search.periode) }),
  loader: async ({ context, deps }) => {
    await prefetchAll(
      context.queryClient.ensureQueryData(stopsQuery({ q: '', limit: STOP_LIMIT })),
      context.queryClient.ensureQueryData(coverageSummaryQuery(deps.period)),
    );
  },
  component: PetaPage,
});