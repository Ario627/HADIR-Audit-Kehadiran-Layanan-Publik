import type { EvidencePack } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { fetchEvidencePack, type EvidenceWindow } from '../../lib/evidence-api';
import {
  bandLabel,
  dayScopeLabel,
  dayScopeNote,
  benchmarkCaption,
  benchmarkHeadline,
  contextSummary,
  dimensionLabel,
  impactLabel,
  percentText,
  provenanceLine,
  qualityActionText,
  qualityLimitingText,
  qualityVerdictText,
  scorePercent,
  shortDigest,
} from '../../lib/evidence-readout';
import { formatDateTime } from '../../lib/time';

const BAND_TONE: Readonly<Record<string, string>> = {
  very_low: 'none',
  low: 'pending',
  moderate: 'indication',
  high: 'verified',
};

const IMPACT_TONE: Readonly<Record<string, string>> = {
  none: 'none',
  minor: 'indication',
  major: 'strong',
  service_stopped: 'alert',
};

export function evidenceQueryKey(stopId: string, window: EvidenceWindow, routeId?: string) {
  return ['evidence', stopId, window, routeId ?? null] as const;
}

export function useEvidencePack(stopId: string, window: EvidenceWindow, routeId?: string) {
  return useQuery({
    queryKey: evidenceQueryKey(stopId, window, routeId),
    queryFn: () =>
      routeId === undefined
        ? fetchEvidencePack(stopId, window)
        : fetchEvidencePack(stopId, window, routeId),
    staleTime: 120_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

function BandChip({ band }: { band: string }) {
  return (
    <span className={`chip chip--${BAND_TONE[band] ?? 'none'}`}>{bandLabel(band)}</span>
  );
}

function QualityRow({ entry }: { entry: EvidencePack['quality']['dimensions'][number] }) {
  const label = dimensionLabel(entry.dimension);
  return (
    <li className="meter">
      <span className="meter-label">{label}</span>
      <span className="meter-value">{percentText(entry.score)}</span>
      <progress
        className={`meter-bar meter-bar--${entry.band}`}
        value={scorePercent(entry.score)}
        max={100}
        aria-label={label}
      >
        {percentText(entry.score)}
      </progress>
    </li>
  );
}

function BenchmarkBlock({ pack }: { pack: EvidencePack }) {
  return (
    <div className="dossier-row">
      <p className="dossier-key">Janji layanan</p>
      <p className="dossier-value">{benchmarkHeadline(pack)}</p>
      <p className="dossier-sub">{benchmarkCaption(pack)}</p>
      {pack.benchmark.status === 'resolved' ? (
        <a
          className="dossier-link"
          href={pack.benchmark.sourceDocumentUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          Dokumen sumber
        </a>
      ) : null}
    </div>
  );
}

export function EvidenceDossier({ pack }: { pack: EvidencePack }) {
  const quality = pack.quality;
  const action = qualityActionText(pack);
  return (
    <section className="dossier" aria-labelledby="dossier-title">
      <header className="dossier-head">
        <h2 id="dossier-title" className="dossier-title">
          Dasar bukti
        </h2>
        <p className="dossier-stamp">{formatDateTime(pack.generatedAt)}</p>
      </header>

      <BenchmarkBlock pack={pack} />

      <div className="dossier-row">
        <p className="dossier-key">
          Mutu bukti <BandChip band={quality.band} />
          <span className="dossier-tag">{dayScopeLabel(pack.dayScope)}</span>
        </p>
        <p className="dossier-sub dossier-sub--quiet">{dayScopeNote(pack)}</p>
        <ul className="meters">
          {quality.dimensions.map((entry) => (
            <QualityRow key={entry.dimension} entry={entry} />
          ))}
        </ul>
        <p className="dossier-sub">{qualityVerdictText(pack)}</p>
        <p className="dossier-sub dossier-sub--quiet">{qualityLimitingText(pack)}</p>
        {action === null ? null : <p className="dossier-sub">{action}</p>}
      </div>

      <div className="dossier-row">
        <p className="dossier-key">Konteks operasional</p>
        <p className="dossier-sub">{contextSummary(pack)}</p>
        {pack.context.events.length === 0 ? null : (
          <ul className="chips">
            {pack.context.events.slice(0, 4).map((event) => (
              <li key={event.id} className={`chip chip--${IMPACT_TONE[event.impact] ?? 'none'}`}>
                {impactLabel(event.impact)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="dossier-more">
        <summary>Metode, sumber, dan keterbatasan</summary>
        {pack.representativeness.limitedTo === null ? null : (
          <p className="dossier-sub">{pack.representativeness.limitedTo}</p>
        )}
        {pack.representativeness.warnings.length === 0 ? null : (
          <ul className="dossier-list">
            {pack.representativeness.warnings.map((warning) => (
              <li key={warning.code}>{warning.detail}</li>
            ))}
          </ul>
        )}
        {pack.snapshot === null ? null : (
          <p className="dossier-sub dossier-sub--mono">
            {provenanceLine(pack)} · hasil {shortDigest(pack.snapshot.outputDigest, 10)}
          </p>
        )}
        {pack.context.caveats.length === 0 ? null : (
          <ul className="dossier-list">
            {pack.context.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        )}
        <p className="dossier-sub dossier-sub--quiet">{pack.disclaimer}</p>
      </details>
    </section>
  );
}

export function EvidenceDossierSection({
  stopId,
  window,
  routeId,
}: {
  stopId: string;
  window: EvidenceWindow;
  routeId?: string;
}) {
  const query = useEvidencePack(stopId, window, routeId);

  if (query.isPending) {
    return (
      <section className="dossier dossier--pending" aria-busy="true">
        <p className="dossier-key">Dasar bukti</p>
        <p className="dossier-sub dossier-sub--quiet">Memuat mutu bukti dan janji layanan.</p>
      </section>
    );
  }

  if (query.isError) {
    return (
      <section className="dossier dossier--pending">
        <p className="dossier-key">Dasar bukti</p>
        <p className="dossier-sub dossier-sub--quiet">
          Rincian bukti belum bisa dimuat sekarang. Estimasi di atas tetap memakai data yang sama.
        </p>
      </section>
    );
  }

  return <EvidenceDossier pack={query.data} />;
}
