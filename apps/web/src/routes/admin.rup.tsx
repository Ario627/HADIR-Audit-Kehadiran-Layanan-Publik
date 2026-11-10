import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
} from '../features/admin/console-ui';
import { fetchRup, importRup } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/time';

const MAX_CSV = 4 * 1024 * 1024;

function AdminRupPage() {
  const [csv, setCsv] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [fiscalYear, setFiscalYear] = useState(String(new Date().getFullYear()));
  const [keyword, setKeyword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const rows = useQuery({
    queryKey: ['admin', 'rup', keyword],
    queryFn: () =>
      fetchRup({
        ...(keyword.trim().length >= 2 ? { keyword: keyword.trim() } : {}),
        limit: 25,
      }),
    staleTime: 30_000,
    retry: false,
  });

  const dryRun = useMutation({
    mutationFn: () => importRup({ csv, sourceUrl: sourceUrl.trim(), fiscalYear: Number(fiscalYear), dryRun: true }),
    retry: 0,
    onSuccess: (result) => {
      setNotice(
        `Uji coba: ${String(result.inserted)} baru, ${String(result.updated)} diperbarui, ${String(result.skipped)} dilewati, ${String(result.issues.length)} masalah. Tidak ada yang disimpan.`,
      );
    },
  });

  const real = useMutation({
    mutationFn: () => importRup({ csv, sourceUrl: sourceUrl.trim(), fiscalYear: Number(fiscalYear), dryRun: false }),
    retry: 0,
    onSuccess: (result) => {
      setNotice(
        `Impor tersimpan: ${String(result.inserted)} baru, ${String(result.updated)} diperbarui, ${String(result.skipped)} dilewati.`,
      );
      setCsv('');
      void rows.refetch();
    },
  });

  const failure =
    dryRun.isError ? describeError(dryRun.error) : real.isError ? describeError(real.error) : null;
  const blocked = csv.trim().length === 0 || sourceUrl.trim().length === 0 || dryRun.isPending || real.isPending;
  const result = dryRun.data ?? real.data;

  return (
    <>
      <div className="page-head">
        <p className="label">RUP</p>
        <h1 className="page-title">Impor paket pengadaan</h1>
        <p className="page-lede">
          RUP dipakai menautkan laporan warga ke anggaran yang seharusnya membiayai layanan. Impor
          selalu bisa diuji tanpa menyimpan.
        </p>
      </div>

      <ConsolePanel title="Impor berkas">
        <div className="console-form">
          <div className="field">
            <label htmlFor="rup-source">URL sumber</label>
            <input
              id="rup-source"
              type="url"
              maxLength={500}
              placeholder="https://"
              value={sourceUrl}
              onChange={(event) => {
                setSourceUrl(event.target.value);
                setNotice(null);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="rup-year">Tahun anggaran</label>
            <input
              id="rup-year"
              type="number"
              min={2000}
              max={2100}
              value={fiscalYear}
              onChange={(event) => {
                setFiscalYear(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="rup-csv">Isi CSV</label>
          <textarea
            id="rup-csv"
            className="console-textarea"
            rows={8}
            maxLength={MAX_CSV}
            value={csv}
            placeholder="satker,nama_paket,lokasi,sumber_dana,pagu,metode,status"
            onChange={(event) => {
              setCsv(event.target.value.slice(0, MAX_CSV));
            }}
          />
          <p className="field-hint">
            Maksimal 4 MB. Baris bermasalah dilaporkan dengan nomornya, bukan dibuang diam-diam.
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

        {result === undefined ? null : result.issues.length === 0 ? null : (
          <details className="console-more" open>
            <summary>Masalah per baris</summary>
            <ul className="dossier-list">
              {result.issues.map((issue) => (
                <li key={`${String(issue.row)}-${issue.message}`}>
                  Baris {String(issue.row)}: {issue.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="actions">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={blocked}
            onClick={() => {
              dryRun.mutate();
            }}
          >
            {dryRun.isPending ? 'Menguji…' : 'Uji tanpa simpan'}
          </button>
          <button
            type="button"
            className="btn"
            disabled={blocked}
            onClick={() => {
              real.mutate();
            }}
          >
            {real.isPending ? 'Mengimpor…' : 'Impor sekarang'}
          </button>
        </div>
      </ConsolePanel>

      <ConsolePanel
        title="Paket tersimpan"
        meta={rows.data === undefined ? 'memuat' : `${String(rows.data.length)} terbaru`}
      >
        <div className="field">
          <label htmlFor="rup-keyword">Cari nama paket</label>
          <input
            id="rup-keyword"
            type="text"
            maxLength={120}
            value={keyword}
            onChange={(event) => {
              setKeyword(event.target.value);
            }}
          />
          <p className="field-hint">Minimal dua karakter untuk mulai mencari.</p>
        </div>

        {rows.isPending ? (
          <ConsoleHint>Memuat paket.</ConsoleHint>
        ) : rows.isError ? (
          <ConsoleFailure
            title={describeError(rows.error).title}
            detail={describeError(rows.error).detail}
            onRetry={() => {
              void rows.refetch();
            }}
          />
        ) : rows.data.length === 0 ? (
          <ConsoleEmpty>Belum ada paket pada filter ini.</ConsoleEmpty>
        ) : (
          <div className="console-table-wrap">
            <table className="console-table">
              <thead>
                <tr>
                  <th scope="col">Paket</th>
                  <th scope="col">Satker</th>
                  <th scope="col">Pagu</th>
                  <th scope="col">Tahun</th>
                  <th scope="col">Diambil</th>
                </tr>
              </thead>
              <tbody>
                {rows.data.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <a
                        href={row.sourceUrl}
                        rel="noreferrer noopener"
                        target="_blank"
                        className="console-table-link"
                      >
                        {row.name}
                      </a>
                      <span className="console-table-sub">
                        {row.location ?? 'lokasi tidak dicantumkan'}
                        {row.method === null ? '' : ` · ${row.method}`}
                      </span>
                    </td>
                    <td>{row.satker}</td>
                    <td>{row.pagu ?? '—'}</td>
                    <td>{String(row.fiscalYear)}</td>
                    <td>{formatDateTime(row.fetchedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/rup')({
  component: AdminRupPage,
});
