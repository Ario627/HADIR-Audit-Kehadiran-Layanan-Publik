import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { ExportForm, type ExportScope } from '../features/partner/ExportForm';
import { ExportHistory } from '../features/partner/ExportHistory';
import { usePartnerProfile } from '../features/partner/use-partner';
import { WindowPicker } from '../features/partner/WindowPicker';
import { apiAssetUrl, apiFetchBlob, isApiError } from '../lib/api';
import {
  MAX_RANGE_DAYS,
  rangeIssues,
  readRange,
  toIsoRange,
  toRangeSearch,
  todayDay,
  type DateRange,
  type RangePreset,
} from '../lib/date-range';
import { describeError } from '../lib/errors';
import {
  exportFilename,
  exportQuotaNote,
  exportRowLimitNote,
  isDownloadable,
  saveBlob,
} from '../lib/export';
import { createExport, exportDetailQuery, exportListQuery } from '../lib/export-api';
import { abilitiesFor } from '../lib/partner';

export interface EksporSearch {
  rentang?: string;
  dari?: string;
  sampai?: string;
}

function EksporPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profile = usePartnerProfile();
  const now = Date.now();
  const today = todayDay(now);
  const selection = readRange(search, now);
  const issue = rangeIssues(selection.range, now, MAX_RANGE_DAYS);

  const [scope, setScope] = useState<ExportScope>({
    format: 'csv',
    category: 'all',
    status: 'all',
  });
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);

  const list = useQuery(exportListQuery());
  const canExport = profile.data === undefined ? false : abilitiesFor(profile.data.role).exportData;

  const create = useMutation({
    mutationFn: () => {
      const iso = toIsoRange(selection.range);
      return createExport({
        format: scope.format,
        ...(iso.from === undefined ? {} : { from: iso.from }),
        ...(iso.to === undefined ? {} : { to: iso.to }),
        ...(scope.category === 'all' ? {} : { category: scope.category }),
        ...(scope.status === 'all' ? {} : { status: scope.status }),
      });
    },
    retry: 0,
    onSuccess: () => {
      setDownloadError(null);
      setDownloadNotice(null);
      void queryClient.invalidateQueries({ queryKey: ['partner', 'exports'] });
    },
  });

  const createError = create.isError ? describeError(create.error) : null;
  const quotaHit = isApiError(create.error) && create.error.code === 'RATE_LIMITED';

  const download = async (exportId: string): Promise<void> => {
    setPendingId(exportId);
    setDownloadError(null);
    setDownloadNotice(null);
    try {
      const detail = await queryClient.fetchQuery(exportDetailQuery(exportId));
      if (!isDownloadable(detail) || detail.downloadUrl === null) {
        setDownloadError('Berkas ini tidak siap diunduh lagi. Buat ekspor baru untuk data yang sama.');
        return;
      }
      if (apiAssetUrl(detail.downloadUrl) === null) {
        setDownloadError('Tautan unduh tidak valid, jadi unduhan dibatalkan.');
        return;
      }
      const blob = await apiFetchBlob(detail.downloadUrl);
      if (!saveBlob(blob, exportFilename(detail.format, detail.exportId))) {
        setDownloadError('Peramban ini tidak bisa menyimpan berkas otomatis. Coba peramban lain.');
        return;
      }
      setDownloadNotice('Berkas mulai diunduh. Tautan unduh berlaku sepuluh menit sejak diminta.');
    } catch (error) {
      setDownloadError(describeError(error).detail);
    } finally {
      setPendingId(null);
    }
  };

  const apply = (next: { preset: RangePreset; range: DateRange }): void => {
    void navigate({ to: '/partner/ekspor', search: toRangeSearch(next) });
  };

  return (
    <>
      <div className="page-head">
        <p className="label">Ekspor</p>
        <h1 className="page-title">Paket bukti untuk instansimu</h1>
        <p className="page-lede">
          Ekspor berisi laporan yang masuk ke instansimu, bukan seluruh basis data HADIR. Berkas dibuat di
          server lalu diunduh lewat tautan bertanda tangan yang berumur pendek.
        </p>
      </div>

      <WindowPicker
        preset={selection.preset}
        range={selection.range}
        issue={issue}
        today={today}
        maxDays={MAX_RANGE_DAYS}
        onChange={apply}
      />

      <ExportForm
        value={scope}
        busy={create.isPending}
        disabled={!canExport || issue !== null}
        onChange={(next) => {
          setScope(next);
        }}
        onSubmit={() => {
          setDownloadNotice(null);
          create.mutate();
        }}
      />

      {createError === null ? null : (
        <div className="alert-box" role="alert">
          <p>{createError.detail}</p>
          {quotaHit ? <p>{exportQuotaNote()}</p> : null}
        </div>
      )}

      {create.isSuccess ? (
        <p className="note" role="status">
          Ekspor dibuat. Berkas muncul di daftar di bawah begitu server selesai menyiapkannya.
        </p>
      ) : null}

      <p className="note">{exportRowLimitNote()}</p>
      <p className="note">{exportQuotaNote()}</p>

      <section aria-labelledby="export-history-title">
        <h2 className="section-title" id="export-history-title">
          Riwayat ekspor
        </h2>

        {downloadNotice === null ? null : (
          <p className="note" role="status">
            {downloadNotice}
          </p>
        )}
        {downloadError === null ? null : (
          <div className="alert-box" role="alert">
            <p>{downloadError}</p>
          </div>
        )}

        {list.isPending ? (
          <p className="note">Memuat riwayat ekspor.</p>
        ) : list.isError ? (
          <>
            <StatePanel tone="error" title={describeError(list.error).title}>
              {describeError(list.error).detail}
            </StatePanel>
            <div className="actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void list.refetch();
                }}
              >
                Coba lagi
              </button>
            </div>
          </>
        ) : list.data === undefined ? (
          <p className="note">Riwayat ekspor tidak bisa ditampilkan.</p>
        ) : (
          <ExportHistory
            items={list.data}
            pendingId={pendingId}
            onDownload={(detail) => {
              void download(detail.exportId);
            }}
          />
        )}
      </section>

      <p className="note">
        Format PDF tidak tersedia di server. Kontrak ekspor hanya mengizinkan CSV dan Open311 JSON, jadi
        halaman ini tidak menawarkan pilihan yang akan gagal. Kalau kamu butuh PDF, cetak halaman laporan
        satu per satu atau olah CSV hasil ekspor.
      </p>
    </>
  );
}

export const Route = createFileRoute('/partner/ekspor')({
  validateSearch: (raw: Record<string, unknown>): EksporSearch =>
    toRangeSearch(readRange(raw, Date.now())),
  component: EksporPage,
});