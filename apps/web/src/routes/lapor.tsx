import type { ReportCategory } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { CategoryPicker } from '../features/triage/CategoryPicker';
import { VerdictCard } from '../features/triage/VerdictCard';
import { useTriage } from '../features/triage/use-triage';
import { StopPicker } from '../features/report/StopPicker';
import { PhotoInput } from '../features/report/PhotoInput';
import { useCreateReport } from '../features/report/use-report-actions';
import { describeError } from '../lib/errors';
import { stopsQuery } from '../lib/queries';
import {
  checkReportText,
  readReportCategory,
  REPORT_MAX_TEXT,
  REPORT_MIN_TEXT,
  warningText,
} from '../lib/report';
import { readStopCode } from '../lib/qr';
import { prefetchAll } from '../lib/prefetch';

export interface LaporSearch {
  halte?: string;
  kategori?: string;
}

function readLaporSearch(raw: Record<string, unknown>): LaporSearch {
  const output: LaporSearch = {};
  const stopCode = readStopCode(raw.halte);
  if (stopCode !== null) {
    output.halte = stopCode;
  }
  const category = readReportCategory(raw.kategori);
  if (category !== null) {
    output.kategori = category;
  }
  return output;
}

function LaporPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const stopCode = readStopCode(search.halte);
  const category = readReportCategory(search.kategori);
  const [text, setText] = useState('');
  const [photoUploadId, setPhotoUploadId] = useState<string | null>(null);
  const triage = useTriage();
  const create = useCreateReport();

  const stop = useQuery({
    ...stopsQuery({ q: stopCode ?? '', limit: 10 }),
    enabled: stopCode !== null,
  });
  const resolvedStop = stop.data?.items.find((item) => item.code === stopCode) ?? null;
  const check = checkReportText(text);
  const canTriage = stopCode !== null && category !== null && check.issue === null;

  function applySearch(next: LaporSearch): void {
    void navigate({ to: '/lapor', search: next });
  }

  if (create.data !== undefined) {
    const report = create.data.report;
    return (
      <>
        <div className="page-head">
          <p className="label">Terkirim</p>
          <h1 className="page-title">Laporan {report.publicId} sudah masuk</h1>
          <p className="page-lede">
            Simpan tautan ini. Status berubah saat instansi menanggapi, dan kamu bisa memverifikasi
            klaim penyelesaian.
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

  const triageError = triage.isError ? describeError(triage.error) : null;
  const createError = create.isError ? describeError(create.error) : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Lapor</p>
        <h1 className="page-title">Sampaikan satu hal yang perlu diperbaiki</h1>
        <p className="page-lede">
          Laporan diperiksa dulu terhadap data resmi dan pengukuran warga, lalu kamu tetap bisa
          mengirimnya apa pun hasilnya.
        </p>
      </div>

      {stopCode === null ? (
        <StopPicker
          disabled={triage.isPending}
          onSelect={(code) => {
            applySearch({ ...search, halte: code });
          }}
        />
      ) : (
        <div className="chosen-stop">
          <p className="label">Halte</p>
          <p className="chosen-stop-name">
            {resolvedStop === null ? stopCode : `${resolvedStop.code} · ${resolvedStop.name}`}
          </p>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              applySearch({ ...search, halte: undefined });
            }}
          >
            Ganti halte
          </button>
        </div>
      )}

      {stopCode !== null && stop.isPending ? (
        <StatePanel title="Memuat halte">Memastikan halte ini masih aktif.</StatePanel>
      ) : null}

      {stopCode !== null && stop.isError ? (
        <StatePanel tone="error" title="Halte tidak bisa dimuat">
          Periksa koneksi lalu coba lagi.
        </StatePanel>
      ) : null}

      {stopCode !== null && stop.isSuccess && resolvedStop === null ? (
        <StatePanel tone="error" title="Halte tidak terdaftar">
          Kode {stopCode} tidak ada di papan bukti. Pilih halte lain.
        </StatePanel>
      ) : null}

      {resolvedStop === null ? null : triage.data !== undefined ? (
        <>
          <VerdictCard
            result={triage.data}
            stopCode={resolvedStop.code}
            routeId={null}
            busy={create.isPending}
            onSend={() => {
              create.mutate({
                stopCode: resolvedStop.code,
                category: category ?? 'other',
                text,
                triageSessionId: triage.data.sessionId,
                photoUploadId,
              });
            }}
            onMeasure={() => {
              void navigate({
                to: '/s/$stopCode',
                params: { stopCode: resolvedStop.code },
              });
            }}
            onCorridor={() => undefined}
            onJoin={(publicId) => {
              void navigate({ to: '/laporan/$publicId', params: { publicId } });
            }}
          />

          {createError === null ? null : (
            <StatePanel tone="error" title={createError.title}>
              {createError.detail}
            </StatePanel>
          )}

          <div className="report-preview">
            <p className="label">Teks yang akan dikirim</p>
            <p className="report-preview-text">{check.text}</p>
          </div>
        </>
      ) : (
        <form
          className="lapor-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (resolvedStop === null || category === null || check.issue !== null) {
              return;
            }
            triage.mutate({
              stopCode: resolvedStop.code,
              routeId: null,
              category,
              text,
            });
          }}
        >
          <CategoryPicker
            value={category}
            disabled={triage.isPending}
            onChange={(next: ReportCategory) => {
              applySearch({ ...search, kategori: next });
            }}
          />

          <PhotoInput
            disabled={triage.isPending}
            onUploaded={(photo) => {
              setPhotoUploadId(photo === null ? null : photo.uploadId);
            }}
          />

          <div className="field">
            <label htmlFor="teks-laporan">Ceritakan kejadiannya</label>
            <textarea
              id="teks-laporan"
              name="teks"
              rows={6}
              maxLength={REPORT_MAX_TEXT}
              value={text}
              disabled={triage.isPending}
              aria-describedby="teks-hint teks-counter"
              aria-invalid={check.issue !== null && check.length > 0}
              onChange={(event) => {
                setText(event.target.value);
              }}
              placeholder="Contoh: bus K3A tidak muncul 07.10–07.40, papan rute tidak diperbarui."
            />
            <span className="field-hint" id="teks-hint">
              Minimal {REPORT_MIN_TEXT} karakter yang bisa dibaca. Tanpa nama, email, atau nomor
              telepon.
            </span>
            <span className="field-hint" id="teks-counter">
              {check.length} dari {REPORT_MIN_TEXT} karakter
            </span>
          </div>

          {triageError === null ? null : (
            <StatePanel tone="error" title={triageError.title}>
              {triageError.detail}
            </StatePanel>
          )}

          <div className="actions">
            <button type="submit" className="btn" disabled={!canTriage || triage.isPending}>
              {triage.isPending ? 'Memeriksa…' : 'Periksa dan lanjut'}
            </button>
            <Link to="/" className="btn btn--ghost">
              Batal
            </Link>
          </div>
        </form>
      )}
    </>
  );
}

export const Route = createFileRoute('/lapor')({
  validateSearch: (raw: Record<string, unknown>): LaporSearch => readLaporSearch(raw),
  loaderDeps: ({ search }) => ({ halte: readStopCode(search.halte) }),
  loader: async ({ context, deps }) => {
    if (deps.halte === null) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(stopsQuery({ q: deps.halte, limit: 10 })));
  },
  component: LaporPage,
});