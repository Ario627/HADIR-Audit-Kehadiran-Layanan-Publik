import type { ReportCategory } from '@hadir/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { StatePanel } from '../components/StatePanel';
import { CategoryPicker } from '../features/triage/CategoryPicker';
import { VerdictCard } from '../features/triage/VerdictCard';
import { useTriage } from '../features/triage/use-triage';
import { StopPicker } from '../features/report/StopPicker';
import { describeError, isNotFound } from '../lib/errors';
import { uuidv7 } from '../lib/id';
import { prefetchAll } from '../lib/prefetch';
import { readStopCode } from '../lib/qr';
import { stopByCodeQuery } from '../lib/queries';
import { readReportCategory } from '../lib/report';
import { writeDraft } from '../lib/draft-store';

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
  const triage = useTriage();
  const lastSignature = useRef<string | null>(null);

  const stop = useQuery(stopByCodeQuery(stopCode));
  const resolvedStop = stop.data === undefined ? null : stop.data;

  useEffect(() => {
    if (stopCode === null || category === null) {
      lastSignature.current = null;
      return;
    }
    const signature = `${stopCode}|${category}`;
    if (lastSignature.current === signature) {
      return;
    }
    lastSignature.current = signature;
    triage.mutate({ stopCode, routeId: null, category, text: '' });
  }, [stopCode, category, triage]);

  function applySearch(next: LaporSearch): void {
    void navigate({ to: '/lapor', search: next });
  }

  function openForm(): void {
    if (stopCode === null || category === null) {
      return;
    }
    const draftId = uuidv7();
    void writeDraft({
      draftId,
      triageSessionId: triage.data === undefined ? null : triage.data.sessionId,
      stopCode,
      category,
      text: '',
      acknowledged: false,
      photoUploadId: null,
      photoSavedAt: null,
    }).then(() => {
      void navigate({ to: '/lapor/$draftId', params: { draftId } });
    });
  }

  const triageError = triage.isError ? describeError(triage.error) : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Lapor</p>
        <h1 className="page-title">Sampaikan satu hal yang perlu diperbaiki</h1>
        <p className="page-lede">
          Pilih halte dan jenis masalahnya dulu. Kami periksa laporanmu terhadap data resmi, lalu kamu
          bisa menulis detail dan mengirim. Menulis panjang baru dilakukan setelah pemeriksaan.
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
              applySearch({ halte: undefined, kategori: search.kategori });
            }}
          >
            Ganti halte
          </button>
        </div>
      )}

      {stopCode !== null && stop.isPending ? (
        <StatePanel title="Memuat halte">Memastikan halte ini masih aktif.</StatePanel>
      ) : null}

      {stopCode !== null && stop.isError && !isNotFound(stop.error) ? (
        <StatePanel tone="error" title="Halte tidak bisa dimuat">
          Periksa koneksi lalu coba lagi.
        </StatePanel>
      ) : null}

      {stopCode !== null && isNotFound(stop.error) ? (
        <StatePanel tone="error" title="Halte tidak terdaftar">
          Kode {stopCode} tidak ada di papan bukti. Pilih halte lain.
        </StatePanel>
      ) : null}

      {resolvedStop === null ? null : (
        <>
          <CategoryPicker
            value={category}
            disabled={triage.isPending}
            invalid={false}
            onChange={(next: ReportCategory) => {
              applySearch({ ...search, kategori: next });
            }}
          />

          {triage.isPending ? (
            <StatePanel title="Memeriksa data">
              Mencocokkan laporan ini dengan rencana layanan dan laporan warga lain.
            </StatePanel>
          ) : null}

          {triageError === null ? null : (
            <>
              <StatePanel tone="error" title={triageError.title}>
                {triageError.detail}
              </StatePanel>
              <div className="actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    if (stopCode === null || category === null) {
                      return;
                    }
                    lastSignature.current = null;
                    triage.mutate({ stopCode, routeId: null, category, text: '' });
                  }}
                >
                  Coba periksa lagi
                </button>
                <button type="button" className="btn btn--ghost" onClick={openForm}>
                  Tetap tulis laporan
                </button>
              </div>
            </>
          )}

          {triage.data === undefined ? null : (
            <>
              <VerdictCard
                result={triage.data}
                stopCode={resolvedStop.code}
                routeId={null}
                busy={false}
                onSend={openForm}
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
              <p className="note">
                Kartu ini menampilkan apa yang sudah tercatat sebelumnya. Menekan kirim membuka formulir
                untuk menulis detail, melampirkan foto, dan mengirim laporan.
              </p>
            </>
          )}
        </>
      )}

      <p className="note">
        Belum punya draf? <Link to="/lapor">Mulai dari awal</Link>. Draf yang sedang kamu tulis
        tersimpan di perangkat ini dan bisa dibuka lagi dari tautannya.
      </p>
    </>
  );
}

export const Route = createFileRoute('/lapor')({
  validateSearch: (raw: Record<string, unknown>): LaporSearch => readLaporSearch(raw),
  loaderDeps: ({ search }): { halte: string | null } => ({ halte: readStopCode(search.halte) }),
  loader: async ({ context, deps }) => {
    if (deps.halte === null) {
      return;
    }
    await prefetchAll(context.queryClient.ensureQueryData(stopByCodeQuery(deps.halte)));
  },
  component: LaporPage,
});
