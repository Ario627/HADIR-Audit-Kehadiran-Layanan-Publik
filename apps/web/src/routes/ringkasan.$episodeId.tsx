import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { StatePanel } from '../components/StatePanel';
import { describeError } from '../lib/errors';
import { isClosedBySystem, outcomeCopy, presenceNote } from '../lib/episode';
import { isUuid } from '../lib/id';
import { prefetchAll } from '../lib/prefetch';
import { episodeQuery } from '../lib/queries';
import { formatClockTime, formatDurationMinutes } from '../lib/time';

function SummaryPage() {
  const { episodeId } = Route.useParams();
  const navigate = useNavigate();
  const validId = isUuid(episodeId);
  const query = useQuery({ ...episodeQuery(episodeId), enabled: validId });
  const episode = query.data?.episode ?? null;

  useEffect(() => {
    if (episode !== null && episode.status === 'active') {
      void navigate({ to: '/wait/$episodeId', params: { episodeId }, replace: true });
    }
  }, [episode, episodeId, navigate]);

  if (!validId) {
    return (
      <StatePanel tone="error" title="Alamat tidak valid">
        Nomor episode pada alamat tidak sesuai format.
      </StatePanel>
    );
  }

  if (episode === null) {
    if (query.isPending) {
      return <StatePanel title="Memuat ringkasan">Mengambil hasil episode.</StatePanel>;
    }
    const message = describeError(query.error);
    return (
      <>
        <StatePanel tone="error" title={message.title}>
          {message.detail}
        </StatePanel>
        <div className="actions">
          <Link to="/" className="btn">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  const copy = episode.outcome === null ? null : outcomeCopy(episode.outcome);
  const note = presenceNote(episode.presence);

  return (
    <>
      <div className="page-head">
        <p className="label">Ringkasan · {episode.stopCode}</p>
        <h1 className="page-title">
          {episode.durationS === null
            ? 'Durasi tidak tercatat'
            : `Kamu menunggu ${formatDurationMinutes(episode.durationS)}`}
        </h1>
        <p className="page-lede">{episode.stopName}</p>
      </div>

      <dl className="ledger">
        <div>
          <dt>Hasil</dt>
          <dd>{copy === null ? '—' : copy.label}</dd>
        </div>
        <div>
          <dt>Mulai</dt>
          <dd>{formatClockTime(episode.startedAt)}</dd>
        </div>
        <div>
          <dt>Selesai</dt>
          <dd>{episode.endedAt === null ? '—' : formatClockTime(episode.endedAt)}</dd>
        </div>
        <div>
          <dt>Sumber waktu</dt>
          <dd>{episode.qualityFlags.includes('client_time') ? 'Perangkat' : 'Server'}</dd>
        </div>
      </dl>

      {isClosedBySystem(episode.outcome) ? (
        <StatePanel title="Ditutup otomatis">
          Server menutup episode ini karena tidak ada aktivitas. Durasi yang tercatat berhenti pada
          aktivitas terakhir, bukan saat kamu benar-benar pergi.
        </StatePanel>
      ) : null}

      {note === null ? null : <p className="note">{note}</p>}

      <p className="note">
        Ini satu episode. Satu catatan belum cukup untuk menyimpulkan layanan di halte ini; angka
        gabungan baru ditampilkan setelah ambang sampel terpenuhi.
      </p>

      <div className="actions">
        <Link to="/" className="btn">
          Ke papan
        </Link>
        <Link to="/metodologi" className="btn btn--ghost">
          Cara angka ini dihitung
        </Link>
      </div>
    </>
  );
}



export const Route = createFileRoute('/ringkasan/$episodeId')({
  loader: async ({ context, params }) => {
    if (!isUuid(params.episodeId)) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(episodeQuery(params.episodeId)));
  },
  component: SummaryPage,
});