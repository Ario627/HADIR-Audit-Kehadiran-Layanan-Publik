import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { AppealView } from '@hadir/contracts';
import { decideAppeal, fetchAppealQueue } from '../../lib/admin-api';
import { describeError } from '../../lib/errors';
import { formatDateTime } from '../../lib/time';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  appealStatusLabel,
} from './console-ui';

const STATUS_TABS = ['submitted', 'admitted', 'decided'] as const;
const OUTCOMES = ['upheld', 'overturned', 'partial', 'inadmissible'] as const;

const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  upheld: 'Tolak banding',
  overturned: 'Batalkan putusan sebelumnya',
  partial: 'Kabulkan sebagian',
  inadmissible: 'Nyatakan tidak dapat diterima',
};

const MIN_NOTE = 10;

function AppealRow({ appeal, canDecide }: { appeal: AppealView; canDecide: boolean }) {
  const queryClient = useQueryClient();
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState<string>('upheld');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => decideAppeal(appeal.id, { outcome, note: note.trim() }),
    retry: 0,
    onSuccess: (result) => {
      setNotice(`Banding diputus: ${result.outcome}. Status laporan ${result.previousReportStatus} → ${result.reportStatus}.`);
      setDeciding(false);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'appeals'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'detail', appeal.publicId] });
      void queryClient.invalidateQueries({ queryKey: ['appeals', appeal.publicId] });
    },
  });

  const failure = mutation.isError ? describeError(mutation.error) : null;

  return (
    <li className="queue-row queue-row--stacked">
      <div className="queue-main">
        <span className="queue-title">
          {appeal.groundsLabel} · {appeal.publicId}
        </span>
        <span className="queue-text">{appeal.statement}</span>
      </div>

      <p className="queue-meta">
        <span className={`chip chip--${appeal.decisionOverdue ? 'alert' : 'pending'}`}>
          {appeal.decisionOverdue ? 'keputusan lewat tenggat' : appealStatusLabel(appeal.status)}
        </span>
        <span>tenggat {formatDateTime(appeal.decisionDue)}</span>
        <span>diajukan {formatDateTime(appeal.createdAt)}</span>
        {appeal.decisionNote === null ? null : (
          <span>catatan: {appeal.decisionNote}</span>
        )}
      </p>

      {appeal.evidenceUrls.length === 0 ? null : (
        <ul className="case-links">
          {appeal.evidenceUrls.map((url, index) => (
            <li key={url}>
              <a href={url} rel="noreferrer noopener" target="_blank">
                Bukti banding {index + 1}
              </a>
            </li>
          ))}
        </ul>
      )}

      {notice === null ? null : (
        <p className="console-notice" role="status">
          {notice}
        </p>
      )}

      {failure === null ? null : (
        <p className="field-error" role="alert">
          {failure.title}. {failure.detail}
        </p>
      )}

      <div className="queue-actions">
        <Link
          to="/admin/laporan/$publicId"
          params={{ publicId: appeal.publicId }}
          className="dossier-link"
        >
          Buka laporan
        </Link>
        {canDecide && appeal.status !== 'upheld' && appeal.status !== 'overturned' ? (
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setDeciding((current) => !current);
            }}
          >
            {deciding ? 'Tutup' : 'Putuskan'}
          </button>
        ) : null}
      </div>

      {deciding ? (
        <div className="console-inline">
          <div className="field">
            <label htmlFor={`appeal-outcome-${appeal.id}`}>Putusan</label>
            <select
              id={`appeal-outcome-${appeal.id}`}
              value={outcome}
              onChange={(event) => {
                setOutcome(event.target.value);
              }}
            >
              {OUTCOMES.map((entry) => (
                <option key={entry} value={entry}>
                  {OUTCOME_LABEL[entry]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`appeal-note-${appeal.id}`}>Pertimbangan</label>
            <textarea
              id={`appeal-note-${appeal.id}`}
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <p className="field-hint">Minimal {MIN_NOTE} karakter, dibaca warga pengaju banding.</p>
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={mutation.isPending || note.trim().length < MIN_NOTE}
              onClick={() => {
                mutation.mutate();
              }}
            >
              {mutation.isPending ? 'Menyimpan…' : 'Simpan putusan banding'}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function AppealQueue({
  canDecide,
  publicId,
}: {
  canDecide: boolean;
  publicId?: string;
}) {
  const [status, setStatus] = useState<string>('submitted');
  const query = useQuery({
    queryKey: ['admin', 'appeals', status],
    queryFn: () => fetchAppealQueue({ status, limit: 25 }),
    staleTime: 15_000,
    retry: false,
  });

  const items =
    publicId === undefined ? query.data : query.data?.filter((entry) => entry.publicId === publicId);

  return (
    <ConsolePanel
      title="Banding"
      meta={items === undefined ? 'memuat' : `${String(items.length)} banding`}
    >
      {publicId === undefined ? (
        <div className="segmented" role="tablist" aria-label="Status banding">
          {STATUS_TABS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={status === entry}
              className={status === entry ? 'segmented-item is-active' : 'segmented-item'}
              onClick={() => {
                setStatus(entry);
              }}
            >
              {entry === 'decided' ? 'sudah diputus' : appealStatusLabel(entry)}
            </button>
          ))}
        </div>
      ) : null}

      {query.isPending ? (
        <ConsoleHint>Memuat banding.</ConsoleHint>
      ) : query.isError ? (
        <ConsoleFailure
          title={describeError(query.error).title}
          detail={describeError(query.error).detail}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : items === undefined || items.length === 0 ? (
        <ConsoleEmpty>
          {publicId === undefined
            ? 'Tidak ada banding pada status ini.'
            : 'Laporan ini belum punya banding pada status terpilih.'}
        </ConsoleEmpty>
      ) : (
        <ul className="queue">
          {items.map((appeal) => (
            <AppealRow key={appeal.id} appeal={appeal} canDecide={canDecide} />
          ))}
        </ul>
      )}
    </ConsolePanel>
  );
}
