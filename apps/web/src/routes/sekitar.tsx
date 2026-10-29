import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { StatePanel } from '../components/StatePanel';
import { NearbyList } from '../features/nearby/NearbyList';
import { PermissionPrimer } from '../features/nearby/PermissionPrimer';
import { useStartEpisode } from '../features/wait/use-episode-actions';
import { writeStoredEpisode } from '../lib/episode-storage';
import { describeError } from '../lib/errors';
import {
  MAX_ACCURACY_M,
  MAX_NEARBY_M,
  NEARBY_LIMIT,
  accuracyBucketOf,
  bboxAround,
  distanceBucketOf,
  formatDistanceMeters,
  nearbyStops,
  offerDecision,
  withinIndonesia,
  type NearbyStop,
} from '../lib/geo';
import { activeEpisodeQuery, stopsQuery } from '../lib/queries';
import { useGeolocation } from '../lib/use-geolocation';

function NearbyPage() {
  const navigate = useNavigate();
  const geo = useGeolocation();
  const active = useQuery(activeEpisodeQuery());
  const start = useStartEpisode();

  const fix = geo.fix;
  const bbox = fix === null ? null : bboxAround(fix, MAX_NEARBY_M);
  const stops = useQuery({
    ...stopsQuery({ q: '', limit: NEARBY_LIMIT, bbox }),
    enabled: bbox !== null,
  });

  const nearby = useMemo(() => {
    if (fix === null || stops.data === undefined) {
      return [];
    }
    return nearbyStops(stops.data.items, fix, fix.accuracyM);
  }, [fix, stops.data]);

  const startError = start.isError ? describeError(start.error) : null;

  function begin(item: NearbyStop): void {
    if (fix === null) {
      return;
    }
    const decision = offerDecision({ distanceM: item.distanceM, accuracyM: item.accuracyM });
    const distanceBucket = distanceBucketOf(item.distanceM);
    const accuracyBucket = accuracyBucketOf(item.accuracyM);
    if (decision !== 'offer' || distanceBucket === null || accuracyBucket === null) {
      return;
    }
    start.mutate(
      {
        stopCode: item.stop.code,
        routeId: null,
        startMode: 'gps_nearby',
        qr: null,
        distanceBucket,
        accuracyBucket,
      },
      {
        onSuccess: (episode) => {
          writeStoredEpisode({
            episodeId: episode.id,
            stopCode: episode.stopCode,
            stopName: episode.stopName,
            routeCode: null,
            startedAt: episode.startedAt,
            startMode: episode.startMode,
            presence: episode.presence,
          });
          void navigate({ to: '/wait/$episodeId', params: { episodeId: episode.id } });
        },
      },
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

  const idle = geo.status === 'idle';

  return (
    <>
      <div className="page-head">
        <p className="label">Mode sekitar</p>
        <h1 className="page-title">Catat tanpa memindai stiker</h1>
        <p className="page-lede">
          Halaman ini mencari halte terdaftar di dekat posisimu. Tawaran mencatat muncul bila jarak dan
          akurasi memenuhi ambang, sehingga angka papan tetap bisa diaudit.
        </p>
      </div>

      {idle ? (
        <PermissionPrimer onRequest={geo.request} busy={false} />
      ) : geo.status === 'locating' ? (
        <StatePanel title="Membaca lokasi">Menunggu titik lokasi dari perangkat.</StatePanel>
      ) : fix === null ? (
        <>
          <StatePanel tone="error" title="Lokasi tidak terbaca">
            {geo.message ?? 'Perangkat tidak mengirim titik lokasi. Pilih halte secara manual.'}
          </StatePanel>
          <div className="actions">
            <button type="button" className="btn" onClick={geo.request}>
              Coba baca ulang
            </button>
            <Link to="/" className="btn btn--ghost">
              Pilih halte manual
            </Link>
          </div>
        </>
      ) : !withinIndonesia(fix) || bbox === null ? (
        <>
          <StatePanel title="Di luar jangkauan data">
            Posisimu berada di luar wilayah yang sudah dipetakan HADIR. Tidak ada halte yang bisa
            ditawarkan dari sini.
          </StatePanel>
          <div className="actions">
            <Link to="/" className="btn">
              Buka papan halte
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="nearby-status">
            Akurasi lokasi sekitar {formatDistanceMeters(fix.accuracyM)} · radius tawaran{' '}
            {MAX_NEARBY_M} m · ambang akurasi {MAX_ACCURACY_M} m
          </p>
          {startError === null ? null : (
            <StatePanel tone="error" title={startError.title}>
              {startError.detail}
            </StatePanel>
          )}
          {stops.isPending ? (
            <StatePanel title="Mencari halte sekitar">Mengambil halte dalam radius tawaran.</StatePanel>
          ) : stops.isError ? (
            <>
              <StatePanel tone="error" title="Halte sekitar tidak bisa dimuat">
                {describeError(stops.error).detail}
              </StatePanel>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    void stops.refetch();
                  }}
                >
                  Coba lagi
                </button>
                <Link to="/" className="btn btn--ghost">
                  Pilih halte manual
                </Link>
              </div>
            </>
          ) : (
            <NearbyList
              items={nearby}
              accuracyM={fix.accuracyM}
              pendingCode={start.isPending ? (start.variables?.stopCode ?? null) : null}
              onPick={begin}
            />
          )}
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/sekitar')({
  component: NearbyPage,
});