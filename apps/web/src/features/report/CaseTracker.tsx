import type { CaseFile } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { fetchCaseFile } from '../../lib/evidence-api';
import {
  attestationLabel,
  attestationTone,
  methodLabel,
  milestoneProgress,
  nextMilestoneText,
  outcomeLabel,
  outcomeTone,
  responseKindLabel,
  resolutionCounts,
  slaHeadline,
  slaPhaseLabel,
  slaPhaseValue,
  verdictLabel,
} from '../../lib/evidence-readout';
import { formatDateTime } from '../../lib/time';

export function caseFileQueryKey(publicId: string) {
  return ['case', publicId] as const;
}

export function useCaseFile(publicId: string) {
  return useQuery({
    queryKey: caseFileQueryKey(publicId),
    queryFn: () => fetchCaseFile(publicId),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

function SlaStrip({ caseFile }: { caseFile: CaseFile }) {
  const sla = caseFile.sla;
  if (sla === null) {
    return null;
  }
  return (
    <div className="case-sla">
      <p className="case-sla-head">
        {slaHeadline(caseFile)}
        <span className="case-sla-version">{sla.policyVersion}</span>
      </p>
      <ol className="case-sla-phases">
        {sla.phases.map((phase) => (
          <li key={phase.phase} className={`case-sla-cell case-sla-cell--${phase.state}`}>
            <span className="case-sla-name">{slaPhaseLabel(phase.phase)}</span>
            <span className="case-sla-value">{slaPhaseValue(phase)}</span>
            <span className="case-sla-due">{formatDateTime(phase.dueAt)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ResponseItem({ entry }: { entry: CaseFile['responses'][number] }) {
  const attestation = entry.attestation;
  return (
    <li className="case-response">
      <p className="case-response-head">
        <span className="case-response-who">{entry.institutionName}</span>
        <span className="case-response-kind">{responseKindLabel(entry.kind)}</span>
        <span className="case-response-time">{formatDateTime(entry.publishedAt)}</span>
      </p>
      <p className="case-response-body">{entry.body}</p>
      {entry.evidenceUrls.length === 0 ? null : (
        <ul className="case-links">
          {entry.evidenceUrls.map((url, index) => (
            <li key={url}>
              <a href={url} rel="noreferrer noopener" target="_blank">
                Bukti {index + 1}
              </a>
            </li>
          ))}
        </ul>
      )}
      {attestation === null ? null : (
        <p className={`attest attest--${attestationTone(attestation)}`}>
          {attestationLabel(attestation)}
          {attestation.keyFingerprint === null ? null : (
            <span className="attest-key">{attestation.keyFingerprint}</span>
          )}
        </p>
      )}
    </li>
  );
}

function VerificationItem({ entry }: { entry: CaseFile['verifications'][number] }) {
  return (
    <li className="case-verify">
      <p className="case-verify-head">
        <span className={`chip chip--${entry.verdict === 'confirmed' ? 'verified' : entry.verdict === 'refuted' ? 'alert' : 'none'}`}>
          {verdictLabel(entry.verdict)}
        </span>
        <span className="case-verify-method">{methodLabel(entry.method)}</span>
        <span className="case-response-time">{formatDateTime(entry.verifiedAt)}</span>
      </p>
      <p className="case-verify-who">{entry.verifierLabel}</p>
      {entry.note === null ? null : <p className="case-response-body">{entry.note}</p>}
    </li>
  );
}

export function CaseTracker({ caseFile }: { caseFile: CaseFile }) {
  const progress = Math.round(milestoneProgress(caseFile) * 100);
  return (
    <section className="case" aria-labelledby="case-title">
      <header className="case-head">
        <h2 id="case-title" className="case-title">
          Jejak penanganan
        </h2>
        <p className="case-sub">{nextMilestoneText(caseFile)}</p>
      </header>

      <progress className="case-bar" value={progress} max={100} aria-label="Kemajuan tahap kasus">
        {String(progress)}%
      </progress>

      {caseFile.milestones.pendingInfoRequest ? (
        <p className="case-callout">Instansi meminta informasi tambahan. Kasus menunggu jawabanmu.</p>
      ) : null}

      <ol className="case-rail">
        {caseFile.milestones.entries.map((entry) => (
          <li
            key={`${entry.key}-${entry.at}`}
            className={entry.terminal ? 'case-step case-step--terminal' : 'case-step'}
          >
            <span className="case-step-dot" aria-hidden="true" />
            <span className="case-step-label">{entry.label}</span>
            <span className="case-step-time">{formatDateTime(entry.at)}</span>
          </li>
        ))}
      </ol>

      <SlaStrip caseFile={caseFile} />

      <div className={`case-verdict case-verdict--${outcomeTone(caseFile.resolution.outcome)}`}>
        <p className="case-verdict-title">{outcomeLabel(caseFile.resolution.outcome)}</p>
        <p className="case-verdict-reason">{caseFile.resolution.reason}</p>
        <p className="case-verdict-counts">{resolutionCounts(caseFile)}</p>
      </div>

      <div className="case-responses">
        <p className="case-block-title">Tanggapan resmi</p>
        {caseFile.responses.length === 0 ? (
          <p className="case-sub">Belum ada tanggapan resmi pada kasus ini.</p>
        ) : (
          <ol className="case-responses-list">
            {caseFile.responses.map((entry) => (
              <ResponseItem key={entry.id} entry={entry} />
            ))}
          </ol>
        )}
      </div>

      {caseFile.verifications.length === 0 ? null : (
        <div className="case-responses">
          <p className="case-block-title">Verifikasi pihak ketiga</p>
          <ol className="case-responses-list">
            {caseFile.verifications.map((entry) => (
              <VerificationItem key={entry.id} entry={entry} />
            ))}
          </ol>
        </div>
      )}

      {caseFile.milestones.gaps.length === 0 &&
      caseFile.resolution.conflicts.length === 0 &&
      caseFile.resolution.cautions.length === 0 &&
      caseFile.caveats.length === 0 &&
      caseFile.milestones.caveats.length === 0 ? null : (
        <details className="case-more">
          <summary>Catatan dan keterbatasan</summary>
          {caseFile.milestones.gaps.length === 0 ? null : (
            <p className="case-sub">Tahap terlewat: {caseFile.milestones.gaps.join(', ')}.</p>
          )}
          {caseFile.resolution.conflicts.length === 0 ? null : (
            <ul className="case-list">
              {caseFile.resolution.conflicts.map((conflict) => (
                <li key={conflict.code}>{conflict.detail}</li>
              ))}
            </ul>
          )}
          {caseFile.resolution.cautions.length === 0 ? null : (
            <ul className="case-list">
              {caseFile.resolution.cautions.map((caution) => (
                <li key={caution}>{caution}</li>
              ))}
            </ul>
          )}
          {caseFile.caveats.length === 0 ? null : (
            <ul className="case-list">
              {caseFile.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          )}
          {caseFile.milestones.caveats.length === 0 ? null : (
            <ul className="case-list">
              {caseFile.milestones.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </section>
  );
}

export function CaseTrackerSection({ publicId }: { publicId: string }) {
  const query = useCaseFile(publicId);

  if (query.isPending) {
    return (
      <section className="case case--pending" aria-busy="true">
        <p className="case-title">Jejak penanganan</p>
        <p className="case-sub">Memuat riwayat kasus.</p>
      </section>
    );
  }

  if (query.isError) {
    return null;
  }

  return <CaseTracker caseFile={query.data} />;
}
