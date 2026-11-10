import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import type { InstitutionScorecard } from '@hadir/contracts';
import { StatePanel } from '../components/StatePanel';
import { describeError } from '../lib/errors';
import { fetchScorecards } from '../lib/governance-api';

export function scorecardsQueryKey() {
  return ['scorecards'] as const;
}

const BAND_LABEL: Readonly<Record<InstitutionScorecard['band'], string>> = {
  very_low: 'sangat rendah',
  low: 'rendah',
  moderate: 'sedang',
  high: 'tinggi',
};

function percent(value: number | null): string {
  return value === null ? '–' : `${String(Math.round(value * 100))}%`;
}

function ScorecardRow({ card }: { card: InstitutionScorecard }) {
  return (
    <li className="scorecard">
      <p className="scorecard__head">
        <span className="scorecard__name">{card.institutionName}</span>
        <span className="scorecard__score">
          {card.rank === null ? 'tanpa peringkat' : `#${String(card.rank)}`}
        </span>
      </p>
      <p className="scorecard__summary">{card.summary}</p>
      {card.state === 'insufficient' ? null : (
        <dl className="scorecard__dimensions">
          {card.dimensions.map((dimension) => (
            <div key={dimension.dimension} className="scorecard__dimension">
              <dt>{dimension.label}</dt>
              <dd>
                {percent(dimension.value)}{' '}
                <span className="scorecard__band">{BAND_LABEL[dimension.band]}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <p className="note">
        {String(card.sample.reportsReceived)} laporan,{' '}
        {String(card.sample.slaTracked)} dengan catatan tenggat,{' '}
        {String(card.sample.appealsDecided)} banding diputuskan dalam{' '}
        {String(card.windowDays)} hari.
      </p>
      {card.warnings.length === 0 ? null : (
        <ul className="scorecard__warnings">
          {card.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </li>
  );
}

function ScorecardPage() {
  const query = useQuery({
    queryKey: scorecardsQueryKey(),
    queryFn: () => fetchScorecards(90),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  if (query.isPending) {
    return <StatePanel title="Memuat kinerja instansi">Menghitung skor proses.</StatePanel>;
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
        </div>
      </>
    );
  }

  const list = query.data;

  return (
    <>
      <h1 className="label">Kinerja instansi</h1>
      <p className="note">
        Skor mengukur proses yang tercatat, bukan kepuasan warga. Instansi dengan laporan
        terlalu sedikit tidak diberi peringkat sama sekali.
      </p>

      {list.items.length === 0 ? (
        <StatePanel title="Belum ada data">Belum ada instansi yang dapat dinilai.</StatePanel>
      ) : (
        <ul className="scorecard-list">
          {list.items.map((card) => (
            <ScorecardRow key={card.institutionId} card={card} />
          ))}
        </ul>
      )}

      <ul className="note-list">
        {list.caveats.map((caveat) => (
          <li key={caveat}>{caveat}</li>
        ))}
      </ul>

      <div className="actions">
        <Link to="/" className="btn btn--ghost">
          Ke papan
        </Link>
        <Link to="/metodologi" className="btn btn--ghost">
          Metodologi
        </Link>
      </div>
    </>
  );
}

export const Route = createFileRoute('/instansi')({
  component: ScorecardPage,
});
