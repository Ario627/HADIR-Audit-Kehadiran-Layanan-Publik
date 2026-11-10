import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { verifyResolution } from '../../lib/admin-api';
import { describeError } from '../../lib/errors';
import { ConsolePanel } from './console-ui';

const METHODS = ['field_inspection', 'observation_data', 'panel_review', 'citizen_confirmation'] as const;
const VERDICTS = ['confirmed', 'refuted', 'inconclusive'] as const;

const METHOD_LABEL: Readonly<Record<string, string>> = {
  field_inspection: 'Pemeriksaan lapangan',
  observation_data: 'Data pengamatan',
  panel_review: 'Tinjauan panel',
  citizen_confirmation: 'Konfirmasi penumpang',
};

const VERDICT_LABEL: Readonly<Record<string, string>> = {
  confirmed: 'Klaim selesai terbukti',
  refuted: 'Klaim selesai dibantah',
  inconclusive: 'Belum bisa disimpulkan',
};

const MIN_REFUTE_NOTE = 10;

export function ResolutionVerify({ publicId }: { publicId: string }) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<string>('field_inspection');
  const [verdict, setVerdict] = useState<string>('confirmed');
  const [note, setNote] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      verifyResolution(publicId, {
        method,
        verdict,
        ...(note.trim().length === 0 ? {} : { note: note.trim() }),
        evidenceUrls: evidenceUrl.trim().length === 0 ? [] : [evidenceUrl.trim()],
      }),
    retry: 0,
    onSuccess: (result) => {
      setNotice(
        `Status ${result.previousStatus} → ${result.status}. Putusan: ${result.outcome}.${result.conflicts.length === 0 ? '' : ` ${String(result.conflicts.length)} konflik tercatat.`}`,
      );
      setNote('');
      setEvidenceUrl('');
      void queryClient.invalidateQueries({ queryKey: ['case', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'detail', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['report', publicId] });
    },
  });

  const failure = mutation.isError ? describeError(mutation.error) : null;
  const needsEvidence = verdict === 'confirmed' && evidenceUrl.trim().length === 0;
  const needsNote = verdict === 'refuted' && note.trim().length < MIN_REFUTE_NOTE;
  const blocked = needsEvidence || needsNote || mutation.isPending;

  return (
    <ConsolePanel title="Verifikasi penyelesaian">
      <p className="console-hint">
        Dipakai saat warga mempersoalkan klaim selesai. Bukti wajib untuk putusan yang menguatkan,
        dan bantahan wajib menyebut dasar pemeriksaannya.
      </p>

      <div className="console-form">
        <div className="field">
          <label htmlFor="resolution-method">Metode</label>
          <select
            id="resolution-method"
            value={method}
            onChange={(event) => {
              setMethod(event.target.value);
              setNotice(null);
            }}
          >
            {METHODS.map((entry) => (
              <option key={entry} value={entry}>
                {METHOD_LABEL[entry]}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="resolution-verdict">Putusan</label>
          <select
            id="resolution-verdict"
            value={verdict}
            onChange={(event) => {
              setVerdict(event.target.value);
              setNotice(null);
            }}
          >
            {VERDICTS.map((entry) => (
              <option key={entry} value={entry}>
                {VERDICT_LABEL[entry]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="resolution-evidence">URL bukti</label>
        <input
          id="resolution-evidence"
          type="url"
          maxLength={500}
          value={evidenceUrl}
          placeholder="https://"
          aria-describedby="resolution-evidence-hint"
          onChange={(event) => {
            setEvidenceUrl(event.target.value);
          }}
        />
        <p className="field-hint" id="resolution-evidence-hint">
          Wajib untuk putusan yang menguatkan klaim. Tautan tampil publik pada berkas kasus.
        </p>
      </div>

      <div className="field">
        <label htmlFor="resolution-note">Catatan pemeriksaan</label>
        <textarea
          id="resolution-note"
          rows={3}
          maxLength={400}
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
        <p className="field-hint">
          {verdict === 'refuted'
            ? `Wajib minimal ${MIN_REFUTE_NOTE} karakter untuk bantahan.`
            : 'Opsional, tetapi membantu pembaca memahami dasar putusan.'}
        </p>
      </div>

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
          className="btn"
          disabled={blocked}
          onClick={() => {
            mutation.mutate();
          }}
        >
          {mutation.isPending ? 'Menyimpan…' : 'Catat putusan'}
        </button>
      </div>
    </ConsolePanel>
  );
}
