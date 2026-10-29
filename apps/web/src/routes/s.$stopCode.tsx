import type { RouteSummary } from '@hadir/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { EstimateBlock } from '../features/estimate/EstimateBlock';
import { StopLead } from '../features/stop/StopLead';
import { canStartAt } from '../lib/stop-status';
import { useStartEpisode } from '../features/wait/use-episode-actions';
import { isApiError } from '../lib/api';
import { describeError } from '../lib/errors';
import { readEstimateWindow, windowLabel, type EstimateWindow } from '../lib/estimate';
import { writeStoredEpisode } from '../lib/episode-storage';
import { prefetchAll } from '../lib/prefetch';
import { readQrProof, readQrSearch, readStopCode, type QrSearchInput } from '../lib/qr';
import { activeEpisodeQuery, estimateQuery, qrLandingQuery, stopByCodeQuery } from '../lib/queries';

function EstimateSection({
  stopId,
  period,
  routeId,
  routeCount,
}: {
  stopId: string;
  period: EstimateWindow;
  routeId: string | null;
  routeCount: number;
}) {
  const query = useQuery(estimateQuery(stopId, period, routeId));

  if (query.isPending) {
    return <StatePanel title="Menghitung estimasi">Mengambil catatan tunggu pada jendela ini.</StatePanel>;
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
            className="btn btn--ghost"
            onClick={() => {
              void query.refetch();
            }}
          >
            Coba hitung lagi
          </button>
        </div>
      </>
    );
  }

  return <EstimateBlock estimate={query.data} simulatedHint={false} routeCount={routeCount} />;
}

function WindowSwitch({ current }: { current: EstimateWindow }) {
  const options: readonly EstimateWindow[] = ['7d', '30d'];
  return (
    <nav className="window-switch" aria-label="Jendela waktu estimasi">
      {options.map((option) => (
        <Link
          key={option}
          to="."
          search={(previous: Record<string, unknown>) => {
            const next: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(previous)) {
              if (key !== 'w') {
                next[key] = value;
              }
            }
            if (option === '30d') {
              next.w = option;
            }
            return next;
          }}
          className={option === current ? 'window-option is-active' : 'window-option'}
          aria-current={option === current ? 'true' : undefined}
        >
          {windowLabel(option)}
        </Link>
      ))}
    </nav>
  );
}

function QrLandingPage() {
  const params = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const code = readStopCode(params.stopCode);
  const proof = readQrProof(search);
  const period = readEstimateWindow(search.w);
  const [routeId, setRouteId] = useState<string | null>(null);

  const active = useQuery(activeEpisodeQuery());
  const landing = useQuery({
    ...qrLandingQuery(code ?? '', search),
    enabled: code !== null && proof !== null,
  });
  const fallback = useQuery({
    ...stopByCodeQuery(code),
    enabled: code !== null,
  });
  const start = useStartEpisode();

  if (code === null) {
    return (
      <>
        <div className="page-head">
          <p className="label">Kode tidak valid</p>
          <h1 className="page-title">Alamat QR ini rusak</h1>
          <p className="page-lede">
            Kode halte pada tautan tidak sesuai format. Pindai ulang stiker atau cari halte di papan.
          </p>
        </div>
        <div className="actions">
          <Link to="/" className="btn">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  const activeEpisode = active.data?.episode ?? null;

  if (activeEpisode !== null) {
    return (
      <>
        <div className="page-head">
          <p className="label">Episode aktif</p>
          <h1 className="page-title">Kamu masih mencatat di {activeEpisode.stopName}</h1>
          <p className="page-lede">
            Satu perangkat hanya mencatat satu episode. Selesaikan dulu episode yang sedang berjalan.
          </p>
        </div>
        <div className="actions">
          <Link to="/wait/$episodeId" params={{ episodeId: activeEpisode.id }} className="btn">
            Buka tiket tunggu
          </Link>
          <Link to="/" className="btn btn--ghost">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  if (proof !== null && landing.isPending) {
    return <StatePanel title="Memeriksa QR">Mencocokkan tanda tangan QR dengan halte ini.</StatePanel>;
  }

  const fallbackStop = fallback.data ?? null;
  const stop = landing.data?.stop ?? fallbackStop;

  if (stop === null) {
    if (fallback.isPending) {
      return <StatePanel title="Mencari halte">Mengambil data halte {code}.</StatePanel>;
    }
    if (fallback.isError && !(isApiError(fallback.error) && fallback.error.code === 'NOT_FOUND')) {
      const message = describeError(fallback.error);
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
                void fallback.refetch();
              }}
            >
              Coba lagi
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        <div className="page-head">
          <p className="label">Tidak ditemukan</p>
          <h1 className="page-title">Halte {code} tidak terdaftar</h1>
          <p className="page-lede">
            Stiker ini menunjuk halte yang tidak ada di papan bukti. Cari halte lain yang terdaftar.
          </p>
        </div>
        <div className="actions">
          <Link to="/" className="btn">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  const routes: readonly RouteSummary[] = stop.routes;
  const verified = landing.data !== undefined;
  const startMode = verified ? 'qr' : 'manual';
  const qrErrorMessage = landing.isError ? describeError(landing.error) : null;
  const startErrorMessage = start.isError ? describeError(start.error) : null;

  function begin(): void {
    if (stop === null) {
      return;
    }
    start.mutate(
      {
        stopCode: stop.code,
        routeId,
        startMode,
        qr: verified ? proof : null,
        distanceBucket: null,
        accuracyBucket: null,
      },
      {
        onSuccess: (episode) => {
          writeStoredEpisode({
            episodeId: episode.id,
            stopCode: episode.stopCode,
            stopName: episode.stopName,
            routeCode: routes.find((route) => route.id === episode.routeId)?.code ?? null,
            startedAt: episode.startedAt,
            startMode: episode.startMode,
            presence: episode.presence,
          });
          void queryClient.invalidateQueries({ queryKey: ['episode'] });
          void navigate({ to: '/wait/$episodeId', params: { episodeId: episode.id } });
        },
      },
    );
  }

  return (
    <>
      <StopLead
        code={stop.code}
        name={stop.name}
        corridors={routes.map((route) => route.code)}
        isDemo={stop.isDemo}
        eyebrow="Halte"
        status={stop.status}
      />

      <WindowSwitch current={period} />
      <EstimateSection
        stopId={stop.id}
        period={period}
        routeId={routeId}
        routeCount={routes.length}
      />

      {qrErrorMessage === null ? (
        <p className="note">
          {verified
            ? 'QR valid. Mode QR tidak memakai lokasi sama sekali.'
            : 'Tautan ini tidak membawa tanda tangan QR, jadi kehadiran tidak terverifikasi.'}
        </p>
      ) : (
        <StatePanel tone="error" title={qrErrorMessage.title}>
          {qrErrorMessage.detail}
        </StatePanel>
      )}

      {routes.length > 1 ? (
        <div className="field">
          <label htmlFor="route-select">Koridor yang kamu tunggu</label>
          <select
            id="route-select"
            value={routeId ?? ''}
            onChange={(event) => {
              setRouteId(event.target.value === '' ? null : event.target.value);
            }}
          >
            <option value="">Semua koridor</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.code} · {route.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {startErrorMessage === null ? null : (
        <StatePanel tone="error" title={startErrorMessage.title}>
          {startErrorMessage.detail}
        </StatePanel>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={begin}
          disabled={start.isPending || !canStartAt(stop.status)}
        >
          {start.isPending ? 'Mencatat…' : 'Mulai menunggu'}
        </button>
        <Link to="/" className="btn btn--ghost">
          Bukan halte ini
        </Link>
      </div>

      <p className="note">Tanpa akun dan tanpa formulir. Satu episode aktif per perangkat.</p>
    </>
  );
}

export const Route = createFileRoute('/s/$stopCode')({
  validateSearch: (raw: Record<string, unknown>): QrSearchInput => readQrSearch(raw),
  loaderDeps: ({ search }): QrSearchInput => search,
  loader: async ({ context, params, deps }) => {
    const code = readStopCode(params.stopCode);
    if (code === null) {
      return;
    }
    const active = context.queryClient.ensureQueryData(activeEpisodeQuery());
    if (readQrProof(deps) !== null) {
      const landing = context.queryClient.ensureQueryData(qrLandingQuery(code, deps));
      const estimate = landing.then((data) =>
        context.queryClient.ensureQueryData(
          estimateQuery(data.stop.id, readEstimateWindow(deps.w), null),
        ),
      );
      await prefetchAll(active, landing, estimate);
      return;
    }
    const stops = context.queryClient.ensureQueryData(stopByCodeQuery(code));
    const estimate = (async () => {
      const data = await stops;
      await context.queryClient.ensureQueryData(
        estimateQuery(data.id, readEstimateWindow(deps.w), null),
      );
    })();
    await prefetchAll(active, stops, estimate);
  },
  component: QrLandingPage,
});