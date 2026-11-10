import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AdminReportDetail } from '@hadir/contracts';
import { moderateReport } from '../../lib/admin-api';
import { describeError } from '../../lib/errors';
import { ConsolePanel, moderationLabel } from './console-ui';

const DECISIONS = ['approved', 'rejected', 'quarantined'] as const;
type Decision = (typeof DECISIONS)[number];

const DECISION_LABEL: Readonly<Record<Decision, string>> = {
  approved: 'Izinkan tampil',
  rejected: 'Tolak',
  quarantined: 'Karantina',
};

const DECISION_HINT: Readonly<Record<Decision, string>> = {
  approved: 'Laporan terlihat publik dan lampirannya ikut disetujui.',
  rejected: 'Laporan tetap tersimpan, tetapi tidak tampil publik.',
  quarantined: 'Disembunyikan sementara sambil menunggu pemeriksaan lanjutan.',
};

const MIN_REASON = 10;

export function ModerationDecision({ report }: { report: AdminReportDetail }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: { decision: Decision; reason?: string }) =>
      moderateReport(report.publicId, input.decision, input.reason),
    retry: 0,
    onSuccess: (result) => {
      setNotice(
        `Moderasi ${report.publicId} berubah dari ${moderationLabel(result.previousModeration)} ke ${moderationLabel(result.moderation)}. ${String(result.mediaUpdated)} lampiran ikut disesuaikan.`,
      );
      setDecision(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'queue'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'detail', report.publicId] });
    },
  });

  const failure = mutation.isError ? describeError(mutation.error) : null;
  const needsReason = decision !== null && decision !== 'approved';
  const blocked = decision === null || (needsReason && reason.trim().length < MIN_REASON);

  return (
    <ConsolePanel
      title="Keputusan moderasi"
      meta={`status sekarang: ${moderationLabel(report.moderation)}`}
    >
      <div className="segmented" role="group" aria-label="Pilih keputusan moderasi">
        {DECISIONS.map((entry) => (
          <button
            key={entry}
            type="button"
            className={decision === entry ? 'segmented-item is-active' : 'segmented-item'}
            aria-pressed={decision === entry}
            onClick={() => {
              setDecision(entry);
              setNotice(null);
            }}
          >
            {DECISION_LABEL[entry]}
          </button>
        ))}
      </div>

      {decision === null ? (
        <p className="console-hint">
          Pilih satu keputusan. Setiap keputusan menulis satu entri audit dan tidak bisa dihapus.
        </p>
      ) : (
        <>
          <p className="console-hint">{DECISION_HINT[decision]}</p>

          {needsReason ? (
            <div className="field">
              <label htmlFor="moderation-reason">Alasan</label>
              <textarea
                id="moderation-reason"
                rows={3}
                maxLength={500}
                value={reason}
                required
                aria-describedby="moderation-reason-hint"
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
              <p className="field-hint" id="moderation-reason-hint">
                Minimal {MIN_REASON} karakter. Warga bisa membaca alasan ini lewat banding, jadi
                tulis sebabnya, bukan kode internal.
              </p>
            </div>
          ) : null}
        </>
      )}

      {failure === null ? null : (
        <p className="field-error" role="alert">
          {failure.title}. {failure.detail}
        </p>
      )}

      {notice === null ? null : (
        <p className="console-notice" role="status">
          {notice}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className={decision === 'rejected' ? 'btn btn--danger' : 'btn'}
          disabled={blocked || mutation.isPending}
          onClick={() => {
            if (decision === null) {
              return;
            }
            mutation.mutate(
              needsReason ? { decision, reason: reason.trim() } : { decision },
            );
          }}
        >
          {mutation.isPending ? 'Menyimpan…' : 'Simpan keputusan'}
        </button>
      </div>
    </ConsolePanel>
  );
}
