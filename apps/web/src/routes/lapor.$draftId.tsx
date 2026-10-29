import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { ErrorSummary } from '../features/forms/ErrorSummary';
import { DraftBanner, DraftSaved } from '../features/report/DraftBanner';
import { ReportFields } from '../features/report/ReportFields';
import { useCreateReport } from '../features/report/use-report-actions';
import { isApiError } from '../lib/api';
import { describeError } from '../lib/errors';
import { hasIssueFor } from '../lib/form-errors';
import { uuidv7 } from '../lib/id';
import { ACK_FIELD_ID, detailIssues, readDraftId } from '../lib/lapor-flow';
import { isRetryableCode, queueReport } from '../lib/outbox-queue';
import { categoryLabel, checkReportText, TEXT_FIELD_ID, warningText } from '../lib/report';
import { useQueuedReport } from '../lib/use-outbox';
import { useReportDraft } from '../lib/use-report-draft';

function ReportFormPage() {
  const params = Route.useParams();
  const navigate = useNavigate();
  const draftId = readDraftId(params.draftId);

  const [stopCode, setStopCode] = useState<string | null>(null);
  const [category, setCategory] = useState<'service_wait' | null>(null);
  const [triageSessionId, setTriageSessionId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [photoUploadId, setPhotoUploadId] = useState<string | null>(null);
  const [photoSavedAt, setPhotoSavedAt] = useState<number | null>(null);
  const [issues, setIssues] = useState<ReturnType<typeof detailIssues>>([]);
  const [submitCount, setSubmitCount] = useState(0);
  const [keptForLater, setKeptForLater] = useState(false);

  const create = useCreateReport();
  const queued = useQueuedReport(draftId ?? '');
  const now = Date.now();

  const draft = useReportDraft({
    draftId: draftId ?? '',
    fields: { text, acknowledged, photoUploadId, photoSavedAt },
    context: { stopCode, category, triageSessionId },
    onRestore: (restored) => {
      setStopCode(restored.stopCode);
      setCategory(restored.category as 'service_wait' | null);
      setTriageSessionId(restored.triageSessionId);
      setText(restored.text);
      setAcknowledged(restored.acknowledged);
      setPhotoUploadId(restored.photoUploadId);
      setPhotoSavedAt(restored.photoSavedAt);
    },
  });

  const { discard } = draft;

  useEffect(() => {
    if (create.data !== undefined) {
      discard();
    }
  }, [create.data, discard]);

  if (draftId === null) {
    return (
      <>
        <div className="page-head">
          <p className="label">Alamat tidak valid</p>
          <h1 className="page-title">Tautan draf ini rusak</h1>
          <p className="page-lede">
            Nomor draf pada alamat tidak sesuai format. Mulai dari pemilihan halte supaya draf baru bisa
            dibuat.
          </p>
        </div>
        <div className="actions">
          <Link to="/lapor" className="btn">
            Mulai laporan baru
          </Link>
        </div>
      </>
    );
  }

  if (!draft.loaded) {
    return <StatePanel title="Membuka draf">Membaca draf yang tersimpan di perangkat ini.</StatePanel>;
  }

  if (create.data !== undefined) {
    const report = create.data.report;
    return (
      <>
        <div className="page-head">
          <p className="label">Terkirim</p>
          <h1 className="page-title">Laporan {report.publicId} sudah masuk</h1>
          <p className="page-lede">
            Simpan tautan ini. Status berubah saat instansi menanggapi, dan kamu bisa memverifikasi klaim
            penyelesaian.
          </p>
        </div>

        {create.data.warnings.map((code) => {
          const note = warningText(code);
          return note === null ? null : (
            <p key={code} className="note">
              {note}
            </p>
          );
        })}

        <div className="actions">
          <Link to="/laporan/$publicId" params={{ publicId: report.publicId }} className="btn">
            Buka laporan
          </Link>
          <Link to="/" className="btn btn--ghost">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  const missingContext = stopCode === null || category === null;

  function submit(): void {
    const found = detailIssues({ stopCode, category, text, acknowledged });
    setIssues(found);
    setSubmitCount((current) => current + 1);
    if (found.length > 0 || stopCode === null || category === null) {
      return;
    }
    create.mutate({
      stopCode,
      category,
      text,
      triageSessionId,
      photoUploadId,
    });
  }

  const createError = create.isError ? describeError(create.error) : null;
  const createCode = create.isError && isApiError(create.error) ? create.error.code : null;
  const canQueue = createCode !== null && isRetryableCode(createCode);
  const waiting = create.data === undefined && (keptForLater || queued !== null);

  if (waiting) {
    return (
      <>
        <div className="page-head">
          <p className="label">Antrean perangkat</p>
          <h1 className="page-title">Laporan menunggu sinyal</h1>
          <p className="page-lede">
            Teks laporan sudah tersimpan di perangkat ini. HADIR mengirim ulang otomatis begitu
            koneksi kembali, dengan kunci idempotensi yang sama supaya tidak ada laporan ganda.
          </p>
        </div>
        <StatePanel title="Yang ikut dan tidak ikut">
          Teks, halte, dan kategori ikut diantrekan. Foto tidak ikut karena unggahan foto
          kedaluwarsa dalam 15 menit, jadi foto lama bisa ditolak server dan membatalkan seluruh
          laporan.
        </StatePanel>
        <div className="actions">
          <Link to="/privasi" className="btn">
            Lihat status laporan
          </Link>
          <Link to="/" className="btn btn--ghost">
            Ke papan
          </Link>
        </div>
      </>
    );
  }

  async function keepForLater(): Promise<void> {
    if (draftId === null || stopCode === null || category === null) {
      return;
    }
    const stored = await queueReport({
      draftId,
      stopCode,
      category,
      text: checkReportText(text).text,
      triageSessionId,
      clientEventId: uuidv7(),
      idempotencyKey: uuidv7(),
    });
    setKeptForLater(stored);
    if (stored) {
      discard();
    }
  }

  return (
    <>
      <div className="page-head">
        <p className="label">Formulir laporan</p>
        <h1 className="page-title">Tulis detail kejadian</h1>
        <p className="page-lede">
          Halte dan kategori sudah terkunci dari langkah sebelumnya. Yang perlu kamu isi hanya cerita
          kejadian, foto kalau ada, dan pernyataan publikasi.
        </p>
      </div>

      {draft.restored === null ? null : (
        <DraftBanner
          draft={draft.restored}
          saving={draft.saving}
          savedAt={draft.savedAt}
          now={now}
          onDiscard={() => {
            discard();
            void navigate({ to: '/lapor', replace: true });
          }}
        />
      )}

      <dl className="facts">
        <div>
          <dt>Halte</dt>
          <dd>{stopCode ?? 'belum dipilih'}</dd>
        </div>
        <div>
          <dt>Kategori</dt>
          <dd>{category === null ? 'belum dipilih' : categoryLabel(category)}</dd>
        </div>
      </dl>

      {missingContext ? (
        <>
          <StatePanel tone="error" title="Draf ini tidak lengkap">
            Halte atau kategori tidak tersimpan pada draf. Ulangi dari pemilihan halte supaya laporan
            masuk ke instansi yang benar.
          </StatePanel>
          <div className="actions">
            <Link to="/lapor" className="btn">
              Mulai laporan baru
            </Link>
          </div>
        </>
      ) : (
        <form
          className="lapor-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <ErrorSummary issues={issues} focusSignal={submitCount} />

          <ReportFields
            text={text}
            acknowledged={acknowledged}
            disabled={create.isPending}
            textInvalid={hasIssueFor(issues, TEXT_FIELD_ID)}
            acknowledgedInvalid={hasIssueFor(issues, ACK_FIELD_ID)}
            onChangeText={(value) => {
              setText(value);
              setIssues([]);
            }}
            onChangeAcknowledged={(value) => {
              setAcknowledged(value);
              setIssues([]);
            }}
            onUploaded={(uploadId) => {
              setPhotoUploadId(uploadId);
              setPhotoSavedAt(uploadId === null ? null : Date.now());
            }}
          />

          <DraftSaved saving={draft.saving} savedAt={draft.savedAt} now={now} />

          {createError === null ? null : (
            <>
              <StatePanel tone="error" title={createError.title}>
                {createError.detail}
              </StatePanel>
              {canQueue ? (
                <div className="actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      void keepForLater();
                    }}
                  >
                    Simpan ke antrean perangkat
                  </button>
                </div>
              ) : null}
            </>
          )}

          <div className="actions">
            <button type="submit" className="btn" disabled={create.isPending}>
              {create.isPending ? 'Mengirim…' : 'Kirim laporan'}
            </button>
            <Link to="/lapor" className="btn btn--ghost">
              Batal
            </Link>
          </div>

          <p className="note">
            Setelah terkirim, draf di perangkat ini dihapus. Laporan tidak bisa disunting, tetapi kamu
            bisa menambahkan dukungan atau memverifikasi penyelesaian dari halaman laporan.
          </p>
        </form>
      )}
    </>
  );
}

export const Route = createFileRoute('/lapor/$draftId')({
  component: ReportFormPage,
});