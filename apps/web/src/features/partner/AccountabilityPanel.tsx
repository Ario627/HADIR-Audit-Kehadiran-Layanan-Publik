import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { PartnerProfile } from '@hadir/contracts';
import { CaseTracker } from '../report/CaseTracker';
import { submitResponse, submitPanelVerdict, fetchPartnerCase, fetchPartnerPanel } from '../../lib/member-api';
import { describeError } from '../../lib/errors';

const KINDS = ['initial', 'follow_up', 'closure_claim', 'correction'] as const;

const KIND_LABEL: Readonly<Record<string, string>> = {
  initial: 'Tanggapan awal',
  follow_up: 'Tindak lanjut',
  closure_claim: 'Klaim selesai',
  correction: 'Koreksi',
};

const METHOD_LABEL: Readonly<Record<string, string>> = {
  field_inspection: 'Pemeriksaan lapangan',
  panel_review: 'Tinjauan panel',
};

const VERDICT_LABEL: Readonly<Record<string, string>> = {
  confirmed: 'Klaim selesai terbukti',
  refuted: 'Klaim selesai dibantah',
  inconclusive: 'Belum bisa disimpulkan',
};

const MIN_BODY = 20;

export function AccountabilityPanel({
  publicId,
  role,
}: {
  publicId: string;
  role: PartnerProfile['role'];
}) {
  const queryClient = useQueryClient();
  const canRespond = role === 'responder' || role === 'admin';

  const [kind, setKind] = useState<string>('initial');
  const [body, setBody] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const [verdictMethod, setVerdictMethod] = useState<string>('field_inspection');
  const [verdict, setVerdict] = useState<string>('confirmed');
  const [verdictNote, setVerdictNote] = useState('');
  const [verdictEvidence, setVerdictEvidence] = useState('');
  const [verdictNotice, setVerdictNotice] = useState<string | null>(null);

  const caseFile = useQuery({
    queryKey: ['partner', 'case', publicId],
    queryFn: () => fetchPartnerCase(publicId),
    staleTime: 20_000,
    retry: false,
  });

  const panel = useQuery({
    queryKey: ['partner', 'panel-detail', publicId],
    queryFn: () => fetchPartnerPanel(publicId),
    staleTime: 20_000,
    retry: false,
  });

  const respond = useMutation({
    mutationFn: () =>
      submitResponse(publicId, {
        kind,
        body: body.trim(),
        evidenceUrls: evidenceUrl.trim().length === 0 ? [] : [evidenceUrl.trim()],
      }),
    retry: 0,
    onSuccess: () => {
      setNotice('Tanggapan tersimpan dan langsung terbaca publik pada berkas kasus.');
      setBody('');
      setEvidenceUrl('');
      void queryClient.invalidateQueries({ queryKey: ['partner', 'case', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['partner', 'report', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['case', publicId] });
    },
  });

  const sendVerdict = useMutation({
    mutationFn: () =>
      submitPanelVerdict(publicId, {
        method: verdictMethod,
        verdict,
        ...(verdictNote.trim().length === 0 ? {} : { note: verdictNote.trim() }),
        evidenceUrls: verdictEvidence.trim().length === 0 ? [] : [verdictEvidence.trim()],
      }),
    retry: 0,
    onSuccess: () => {
      setVerdictNotice('Putusan panel tercatat.');
      setVerdictNote('');
      setVerdictEvidence('');
      void queryClient.invalidateQueries({ queryKey: ['partner', 'case', publicId] });
      void queryClient.invalidateQueries({ queryKey: ['case', publicId] });
    },
  });

  const respondFailure = respond.isError ? describeError(respond.error) : null;
  const verdictFailure = sendVerdict.isError ? describeError(sendVerdict.error) : null;
  const blocked = respond.isPending || body.trim().length < MIN_BODY;
  const verdictBlocked =
    sendVerdict.isPending ||
    (verdict === 'confirmed' && verdictEvidence.trim().length === 0) ||
    (verdict === 'refuted' && verdictNote.trim().length < 10);

  return (
    <>
      {caseFile.isPending ? (
        <p className="console-hint">Memuat berkas kasus.</p>
      ) : caseFile.isError ? (
        <p className="console-hint">
          Berkas kasus belum bisa dimuat sekarang. Tindakan pada laporan tetap tersedia di panel
          tindakan.
        </p>
      ) : (
        <CaseTracker caseFile={caseFile.data} />
      )}

      {canRespond ? (
        <section className="console-panel" aria-labelledby="partner-response-title">
          <header className="console-panel-head">
            <h2 className="console-panel-title" id="partner-response-title">
              Tanggapan resmi
            </h2>
            <p className="console-panel-meta">tampil publik beserta nama instansi</p>
          </header>

          <div className="console-form">
            <div className="field">
              <label htmlFor="response-kind">Jenis</label>
              <select
                id="response-kind"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value);
                  setNotice(null);
                }}
              >
                {KINDS.map((entry) => (
                  <option key={entry} value={entry}>
                    {KIND_LABEL[entry]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="response-evidence">URL bukti</label>
              <input
                id="response-evidence"
                type="url"
                maxLength={500}
                placeholder="https://"
                value={evidenceUrl}
                onChange={(event) => {
                  setEvidenceUrl(event.target.value);
                }}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="response-body">Isi tanggapan</label>
            <textarea
              id="response-body"
              rows={4}
              maxLength={4000}
              value={body}
              aria-describedby="response-body-hint"
              onChange={(event) => {
                setBody(event.target.value);
              }}
            />
            <p className="field-hint" id="response-body-hint">
              Minimal {MIN_BODY} karakter. Tanggapan ditandatangani sebelum disimpan, dan tanda
              tangannya bisa diperiksa publik.
            </p>
          </div>

          {respondFailure === null ? null : (
            <p className="field-error" role="alert">
              {respondFailure.title}. {respondFailure.detail}
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
                respond.mutate();
              }}
            >
              {respond.isPending ? 'Menyimpan…' : 'Kirim tanggapan'}
            </button>
          </div>
        </section>
      ) : (
        <section className="console-panel">
          <p className="console-hint">
            Peran pembaca tidak bisa mengirim tanggapan resmi. Minta admin instansi mengubah peran
            bila kamu perlu menanggapi.
          </p>
        </section>
      )}

      {panel.data === undefined || !panel.data.canVerify || !canRespond ? null : (
        <section className="console-panel" aria-labelledby="panel-verdict-title">
          <header className="console-panel-head">
            <h2 className="console-panel-title" id="panel-verdict-title">
              Putusan panel
            </h2>
            <p className="console-panel-meta">{panel.data.summary}</p>
          </header>

          <div className="console-form">
            <div className="field">
              <label htmlFor="verdict-method">Metode</label>
              <select
                id="verdict-method"
                value={verdictMethod}
                onChange={(event) => {
                  setVerdictMethod(event.target.value);
                  setVerdictNotice(null);
                }}
              >
                {Object.keys(METHOD_LABEL).map((entry) => (
                  <option key={entry} value={entry}>
                    {METHOD_LABEL[entry]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="verdict-value">Putusan</label>
              <select
                id="verdict-value"
                value={verdict}
                onChange={(event) => {
                  setVerdict(event.target.value);
                  setVerdictNotice(null);
                }}
              >
                {Object.keys(VERDICT_LABEL).map((entry) => (
                  <option key={entry} value={entry}>
                    {VERDICT_LABEL[entry]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="verdict-evidence">URL bukti</label>
            <input
              id="verdict-evidence"
              type="url"
              maxLength={500}
              placeholder="https://"
              value={verdictEvidence}
              onChange={(event) => {
                setVerdictEvidence(event.target.value);
              }}
            />
            <p className="field-hint">Wajib untuk putusan yang menguatkan klaim selesai.</p>
          </div>

          <div className="field">
            <label htmlFor="verdict-note">Keterangan</label>
            <textarea
              id="verdict-note"
              rows={3}
              maxLength={400}
              value={verdictNote}
              onChange={(event) => {
                setVerdictNote(event.target.value);
              }}
            />
            <p className="field-hint">Wajib minimal 10 karakter untuk putusan yang membantah.</p>
          </div>

          {verdictFailure === null ? null : (
            <p className="field-error" role="alert">
              {verdictFailure.title}. {verdictFailure.detail}
            </p>
          )}
          {verdictNotice === null ? null : (
            <p className="console-notice" role="status">
              {verdictNotice}
            </p>
          )}

          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={verdictBlocked}
              onClick={() => {
                sendVerdict.mutate();
              }}
            >
              {sendVerdict.isPending ? 'Menyimpan…' : 'Catat putusan panel'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
