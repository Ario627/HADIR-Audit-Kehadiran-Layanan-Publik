import type { TriageResult } from '@hadir/contracts';
import { connectorNote, joinTarget, planActions, unsupportedLabels } from '../../lib/triage';
import { safeExternalUrl } from '../../lib/safe-url';
import { SourceChip } from './SourceChip';

export interface VerdictCardProps {
  result: TriageResult;
  stopCode: string;
  routeId: string | null;
  busy: boolean;
  onMeasure: () => void;
  onSend: () => void;
  onCorridor: () => void;
  onJoin: (publicId: string) => void;
}

export function VerdictCard({
  result,
  stopCode,
  routeId,
  busy,
  onMeasure,
  onSend,
  onCorridor,
  onJoin,
}: VerdictCardProps) {
  const target = joinTarget(result);
  const planned = planActions(result.actions, { hasRoute: routeId !== null, joinTarget: target });
  const unsupported = unsupportedLabels(planned);
  const note = connectorNote(result.connectors);

  return (
    <section className="verdict" aria-labelledby="verdict-headline">
      <p className="label">Hasil pemeriksaan awal</p>
      <h2 className="verdict-headline" id="verdict-headline">
        {result.headline}
      </h2>
      <p className="verdict-body">{result.body}</p>

      {note === null ? null : <p className="verdict-note">{note}</p>}

      {result.evidence.length === 0 ? null : (
        <ul className="evidence-list">
          {result.evidence.map((item) => {
            const url = safeExternalUrl(item.sourceUrl);
            return (
              <li key={item.id} className="evidence-item">
                <SourceChip tier={item.tier} />
                <p className="evidence-claim">{item.claim}</p>
                <p className="evidence-meta">
                  {item.label}
                  {url === null ? null : (
                    <>
                      {' · '}
                      <a href={url} target="_blank" rel="noopener noreferrer">
                        Sumber
                        <span className="visually-hidden"> untuk {item.claim}, buka di tab baru</span>
                      </a>
                    </>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="verdict-actions">
        <button type="button" className="btn" onClick={onSend} disabled={busy}>
          {busy ? 'Mengirim…' : 'Tetap kirim laporan'}
        </button>
        {planned.some((action) => action.intent === 'join') && target !== null ? (
          <button type="button" className="btn btn--ghost" onClick={() => onJoin(target)} disabled={busy}>
            Gabung ke laporan {target}
          </button>
        ) : null}
        {planned.some((action) => action.intent === 'measure') ? (
          <button type="button" className="btn btn--ghost" onClick={onMeasure} disabled={busy}>
            Ukur tunggu di {stopCode}
          </button>
        ) : null}
        {planned.some((action) => action.intent === 'corridor') ? (
          <button type="button" className="btn btn--ghost" onClick={onCorridor} disabled={busy}>
            Lihat koridor
          </button>
        ) : null}
      </div>

      {unsupported.length === 0 ? null : (
        <p className="verdict-note">
          Belum bisa dilakukan dari aplikasi ini: {unsupported.join(' · ')}.
        </p>
      )}
    </section>
  );
}