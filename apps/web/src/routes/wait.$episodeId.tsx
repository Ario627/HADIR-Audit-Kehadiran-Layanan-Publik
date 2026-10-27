import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { OutcomeActions } from '../features/wait/OutcomeActions';
import { SyncStatus, type SyncPhase } from '../features/wait/SyncStatus';
import { WaitTicket } from '../features/wait/WaitTicket';
import { useEndEpisode, useHeartbeat } from '../features/wait/use-episode-actions';
import { describeError } from '../lib/errors';
import { elapsedSeedMs, ticketFromEpisode, type EndOutcome } from '../lib/episode';
import {
  clearStoredEpisode,
  readStoredEpisode,
  ticketFromStorage,
  type StoredEpisode,
} from '../lib/episode-storage';
import { isUuid } from '../lib/id';
import { prefetchAll } from '../lib/prefetch';
import { episodeQuery } from '../lib/queries';
import { useElapsedSeconds } from '../lib/use-elapsed-seconds';
import { useOnline } from '../lib/use-online';

function WaitPage() {
  const { episodeId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const [stored] = useState<StoredEpisode | null>(() => readStoredEpisode());
  const validId = isUuid(episodeId);

  const query = useQuery({ ...episodeQuery(episodeId), enabled: validId });
  const end = useEndEpisode(validId ? episodeId : '');

  const snapshot = query.data;
  const episode = snapshot?.episode ?? null;
  const usableStored = stored !== null && stored.episodeId === episodeId ? stored : null;

  const seedMs =
    episode !== null
      ? elapsedSeedMs(episode.startedAt, snapshot?.serverNow ?? null)
      : usableStored !== null
        ? elapsedSeedMs(usableStored.startedAt, null)
        : null;

  const running = episode === null || episode.status === 'active';
  const seconds = useElapsedSeconds(seedMs, running);

  useHeartbeat(episodeId, validId && episode !== null && episode.status === 'active');

  useEffect(() => {
    if (episode === null || episode.status !== 'ended') {
      return;
    }
    clearStoredEpisode();
    void navigate({ to: '/', replace: true });
  }, [episode, navigate]);

  function finish(outcome: EndOutcome): void {
    end.mutate(outcome, {
      onSuccess: () => {
        clearStoredEpisode();
        void queryClient.invalidateQueries({ queryKey: ['episode'] });
        void navigate({ to: '/' });
      },
    });
  }

  if (!validId) {
    return (
      <>
        <div className="page-head">
          <p className="label">Alamat tidak valid</p>
          <h1 className="page-title">Tiket ini tidak dikenali</h1>
          <p className="page-lede">
            Nomor episode pada alamat tidak sesuai format. Mulai pengukuran baru dari papan bukti.
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

  if (episode === null) {
    if (query.isPending) {
      return <StatePanel title="Menyiapkan tiket">Mengambil episode dari server.</StatePanel>;
    }
    if (usableStored !== null) {
      const view = ticketFromStorage(usableStored);
      return (
        <>
          <div className="page-head">
            <p className="label">Sedang mencatat</p>
            <h1 className="page-title">{view.name}</h1>
          </div>
          <WaitTicket
            view={view}
            seconds={seconds}
            actions={
              <p className="ticket-note">
                Hasil belum bisa dikirim karena server tidak terjangkau. Waktu tetap dihitung dari
                perangkat ini.
              </p>
            }
            status={<SyncStatus online={online} phase="unreachable" source="device" />}
          />
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void query.refetch();
              }}
            >
              Coba hubungkan lagi
            </button>
            <Link to="/" className="btn btn--ghost">
              Ke papan
            </Link>
          </div>
        </>
      );
    }
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

  const view = ticketFromEpisode(episode, usableStored?.routeCode ?? null);
  const phase: SyncPhase = end.isPending ? 'saving' : end.isError ? 'error' : 'idle';
  const endErrorMessage = end.isError ? describeError(end.error) : null;
  const failedOutcome = end.isError ? end.variables : undefined;
  const busyOutcome = end.isPending ? (end.variables ?? null) : null;
  const disabled = end.isPending || !online;

  return (
    <>
      <div className="page-head">
        <p className="label">Sedang mencatat</p>
        <h1 className="page-title">{view.name}</h1>
      </div>

      <WaitTicket
        view={view}
        seconds={seconds}
        actions={<OutcomeActions busyOutcome={busyOutcome} disabled={disabled} onSelect={finish} />}
        status={
          <SyncStatus
            online={online}
            phase={phase}
            source={view.source}
            {...(failedOutcome === undefined ? {} : { onRetry: () => finish(failedOutcome) })}
          />
        }
      />

      {endErrorMessage === null ? null : (
        <StatePanel tone="error" title={endErrorMessage.title}>
          {endErrorMessage.detail}
        </StatePanel>
      )}

      <p className="note">
        {online
          ? 'Tutup aplikasi tidak menghentikan waktu, tetapi episode tanpa aktivitas ditutup otomatis oleh server.'
          : 'Tombol hasil aktif lagi setelah koneksi kembali. Waktu tetap berjalan.'}
      </p>
    </>
  );
}

export const Route = createFileRoute('/wait/$episodeId')({
  loader: async ({ context, params }) => {
    if (!isUuid(params.episodeId)) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(episodeQuery(params.episodeId)));
  },
  component: WaitPage,
});