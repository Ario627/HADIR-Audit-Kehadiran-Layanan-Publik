import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { RunwayTape } from '../features/radar/RunwayTape';
import { RunwayTimeline } from '../features/radar/RunwayTimeline';
import { isApiError } from '../lib/api';
import { describeError } from '../lib/errors';
import { isUuid } from '../lib/id';
import { prefetchAll } from '../lib/prefetch';
import { runwayByRouteQuery } from '../lib/queries';
import { decisionText, runwayStatusLabel, urgencyOf } from '../lib/runway';

function RadarPage() {
  const { routeId } = Route.useParams();
  const validId = isUuid(routeId);
  const query = useQuery({ ...runwayByRouteQuery(routeId), enabled: validId });

  if (!validId) {
    return (
      <StatePanel tone="error" title="Alamat tidak valid">
        Nomor koridor pada alamat tidak sesuai format.
      </StatePanel>
    );
  }

  if (query.isPending) {
    return <StatePanel title="Memuat radar">Mengambil catatan pendanaan koridor ini.</StatePanel>;
  }

  if (query.isError) {
    const missing = isApiError(query.error) && query.error.code === 'NOT_FOUND';
    if (missing) {
      return (
        <>
          <div className="page-head">
            <p className="label">Radar</p>
            <h1 className="page-title">Belum ada catatan pendanaan</h1>
            <p className="page-lede">
              Koridor ini belum punya tanggal pendanaan yang dilaporkan. Tanpa tanggal, radar tidak
              bisa digambar tanpa mengarang.
            </p>
          </div>
          <div className="actions">
            <Link to="/koridor/$routeId" params={{ routeId }} className="btn">
              Lihat koridor
            </Link>
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

  const runway = query.data;
  const urgency = urgencyOf(runway.urgency);
  const decision = decisionText(runway);

  return (
    <>
      <div className="page-head">
        <p className="label">
          Radar · {runway.routeCode}
          {runway.simulated ? ' · simulasi' : ''}
        </p>
        <h1 className="page-title">{runway.routeName}</h1>
        <p className="page-lede">
          {runwayStatusLabel(runway.status)} · {urgency.label}
        </p>
      </div>

      <section className="radar" data-tone={urgency.tone} aria-labelledby="radar-urgency">
        <h2 className="label" id="radar-urgency">
          Status pendanaan
        </h2>
        <p className="radar-urgency">{urgency.label}</p>
        <p className="radar-detail">{urgency.detail}</p>
        <RunwayTape
          fundedUntil={runway.fundedUntil}
          daysRemaining={runway.daysRemaining}
          sourceUrl={runway.sourceUrl}
        />
        {decision === null ? null : <p className="radar-decision">{decision}</p>}
        {runway.sanctions.length === 0 ? null : (
          <ul className="warnings">
            {runway.sanctions.map((sanction) => (
              <li key={sanction}>{sanction}</li>
            ))}
          </ul>
        )}
        {runway.note === null ? null : <p className="note">{runway.note}</p>}
      </section>

      <p className="note">{runway.disclaimer}</p>

      <RunwayTimeline events={runway.events} />

      <div className="actions">
        <Link to="/koridor/$routeId" params={{ routeId }} className="btn btn--ghost">
          Halte di koridor ini
        </Link>
        <Link to="/" className="btn btn--ghost">
          Ke papan
        </Link>
      </div>

      <p className="note">
        Dukungan warga pada titik keputusan belum tersedia: belum ada jalur pengiriman resmi di
        aplikasi ini, dan tombol yang tidak mengirim apa pun hanya akan menyesatkan.
      </p>
    </>
  );
}

export const Route = createFileRoute('/radar/$routeId')({
  loader: async ({ context, params }) => {
    if (!isUuid(params.routeId)) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(runwayByRouteQuery(params.routeId)));
  },
  component: RadarPage,
});