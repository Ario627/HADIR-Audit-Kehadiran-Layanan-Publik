import type { PartnerAction, PartnerActionResult } from '@hadir/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { uuidv7 } from '../../lib/id';
import {
  PARTNER_ACTIONS,
  actionIssueText,
  actionSpec,
  buildActionInput,
  issuesForAction,
  minScheduleValue,
  type ActionIssue,
  type ActionValues,
} from '../../lib/partner';
import { actOnReport } from '../../lib/partner-api';

export interface ActionPanelProps {
  publicId: string;
  canAct: boolean;
  now: number;
}

const EMPTY: ActionValues = { note: '', reason: '', scheduledFor: '' };
const MAX_MS = 5 * 60_000;
const SIGNATURE_SEPARATOR = '\u0001';

interface Attempt {
  signature: string;
  key: string;
  createdAt: number;
}

function signatureOf(publicId: string, action: PartnerAction, values: ActionValues): string {
  return [publicId, action, values.note.trim(), values.reason.trim(), values.scheduledFor].join(
    SIGNATURE_SEPARATOR,
  );
}

function attemptFor(holder: { current: Attempt | null }, signature: string, now: number): Attempt {
  const current = holder.current;
  if (current !== null && current.signature === signature && now - current.createdAt < MAX_MS) {
    return current;
  }
  const next: Attempt = { signature, key: uuidv7(), createdAt: now };
  holder.current = next;
  return next;
}

export function ActionPanel({ publicId, canAct, now }: ActionPanelProps) {
  const queryClient = useQueryClient();
  const holder = useRef<Attempt | null>(null);
  const [action, setAction] = useState<PartnerAction | null>(null);
  const [values, setValues] = useState<ActionValues>(EMPTY);
  const [issues, setIssues] = useState<readonly ActionIssue[]>([]);
  const [result, setResult] = useState<PartnerActionResult | null>(null);

  const mutate = useMutation({
    mutationFn: (input: { action: PartnerAction; values: ActionValues; key: string }) =>
      actOnReport(publicId, buildActionInput(input.action, input.values), input.key),
    retry: 0,
    onSuccess: (payload) => {
      setResult(payload);
      setAction(null);
      setValues(EMPTY);
      setIssues([]);
      holder.current = null;
      void queryClient.invalidateQueries({ queryKey: ['partner', 'report', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['partner', 'inbox'] });
      void queryClient.invalidateQueries({ queryKey: ['partner', 'analytics'] });
    },
  });

  const errorMessage = mutate.isError ? describeError(mutate.error) : null;
  const fieldErrors = isApiError(mutate.error) ? mutate.error.fieldErrors : [];
  const fieldError = (name: string): string | null =>
    fieldErrors.find((entry) => entry.field === name)?.message ?? null;

  const choose = (next: PartnerAction): void => {
    setResult(null);
    setIssues([]);
    setValues(EMPTY);
    setAction((current) => (current === next ? null : next));
    mutate.reset();
  };

  const submit = (): void => {
    if (action === null) {
      return;
    }
    const found = issuesForAction(action, values, now);
    setIssues(found);
    if (found.length > 0) {
      return;
    }
    const attempt = attemptFor(holder, signatureOf(publicId, action, values), now);
    mutate.mutate({ action, values, key: attempt.key });
  };

  if (!canAct) {
    return (
      <section className="actionpanel" aria-labelledby="actionpanel-title">
        <h2 className="section-title" id="actionpanel-title">
          Tindakan
        </h2>
        <p className="note">
          Role kamu hanya bisa membaca. Aksi status hanya tersedia untuk role penanggap atau admin
          instansi.
        </p>
      </section>
    );
  }

  const spec = action === null ? null : actionSpec(action);

  return (
    <section className="actionpanel" aria-labelledby="actionpanel-title">
      <h2 className="section-title" id="actionpanel-title">
        Tindakan
      </h2>

      <div className="actionpanel-choices" role="group" aria-label="Pilih tindakan">
        {PARTNER_ACTIONS.map((entry) => {
          const item = actionSpec(entry);
          return (
            <button
              key={entry}
              type="button"
              className={item.tone === 'danger' ? 'btn btn--danger' : 'btn btn--ghost'}
              aria-pressed={action === entry}
              onClick={() => {
                choose(entry);
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {spec === null ? (
        <p className="note">
          Setiap tindakan tercatat di riwayat laporan dan bisa dibaca publik, kecuali keterangan yang
          ditandai internal oleh sistem.
        </p>
      ) : (
        <form
          className="actionpanel-form"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <p className="actionpanel-confirm">{spec.confirm}</p>

          {spec.scheduleRequired ? (
            <div className="field">
              <label htmlFor="action-schedule">Waktu tindak lanjut</label>
              <input
                id="action-schedule"
                type="datetime-local"
                min={minScheduleValue(now)}
                value={values.scheduledFor}
                required
                aria-invalid={
                  issues.includes('schedule_required') || issues.includes('schedule_in_past')
                }
                onChange={(event) => {
                  setValues((current) => ({ ...current, scheduledFor: event.target.value }));
                }}
              />
              <p className="field-hint">Tampil di halaman publik sebagai jadwal penanganan.</p>
            </div>
          ) : null}

          {spec.noteLabel === null ? null : (
            <div className="field">
              <label htmlFor="action-note">{spec.noteLabel}</label>
              <textarea
                id="action-note"
                rows={4}
                maxLength={500}
                value={values.note}
                aria-invalid={issues.includes('note_required') || issues.includes('note_too_short')}
                onChange={(event) => {
                  setValues((current) => ({ ...current, note: event.target.value }));
                }}
              />
              <p className="field-hint">
                {spec.noteMin > 0 ? `Minimal ${spec.noteMin} karakter. ` : 'Boleh dikosongkan. '}
                {action === 'respond'
                  ? 'Teks ini tampil di halaman publik laporan.'
                  : 'Tercatat di riwayat laporan.'}
              </p>
              {fieldError('note') === null ? null : <p className="field-error">{fieldError('note')}</p>}
            </div>
          )}

          {spec.reasonRequired ? (
            <div className="field">
              <label htmlFor="action-reason">Alasan penolakan</label>
              <textarea
                id="action-reason"
                rows={3}
                maxLength={200}
                value={values.reason}
                required
                aria-invalid={issues.includes('reason_required')}
                onChange={(event) => {
                  setValues((current) => ({ ...current, reason: event.target.value }));
                }}
              />
              <p className="field-hint">Alasan ikut tercatat agar warga tahu mengapa ditolak.</p>
              {fieldError('reason') === null ? null : (
                <p className="field-error">{fieldError('reason')}</p>
              )}
            </div>
          ) : null}

          {issues.length === 0 ? null : (
            <div className="alert-box" role="alert">
              <ul className="actionpanel-issues">
                {issues.map((issue) => (
                  <li key={issue}>{actionIssueText(issue)}</li>
                ))}
              </ul>
            </div>
          )}

          {fieldError('scheduledFor') === null ? null : (
            <p className="field-error">{fieldError('scheduledFor')}</p>
          )}

          {errorMessage === null ? null : (
            <div className="alert-box" role="alert">
              <p>{errorMessage.detail}</p>
            </div>
          )}

          <div className="actions">
            <button type="submit" className="btn" disabled={mutate.isPending}>
              {mutate.isPending ? 'Mengirim' : spec.label}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setAction(null);
                mutate.reset();
              }}
            >
              Batal
            </button>
          </div>

          <p className="note">
            Setiap aksi butuh konfirmasi. Permintaan yang gagal di jaringan dikirim ulang dengan kunci
            idempoten yang sama, jadi tidak ada aksi ganda.
          </p>
        </form>
      )}

      {result === null ? null : (
        <p className="note" role="status">
          Status berubah dari {result.previousStatus} menjadi {result.status}
          {result.simulated
            ? ' (simulasi: tidak ada pekerja lapangan yang benar-benar ditugaskan).'
            : '.'}
        </p>
      )}
    </section>
  );
}