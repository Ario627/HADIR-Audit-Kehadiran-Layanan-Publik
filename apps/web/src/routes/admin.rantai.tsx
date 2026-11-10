import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { ConsoleEmpty, ConsoleHint, ConsolePanel } from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import { sealAnchor, verifyChain } from '../lib/admin-api';
import { describeError } from '../lib/errors';

function AdminChainPage() {
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';
  const [anchorDate, setAnchorDate] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const chain = useMutation({
    mutationFn: () => verifyChain({ maxReports: 500 }),
    retry: 0,
  });

  const anchor = useMutation({
    mutationFn: () => sealAnchor(anchorDate, false),
    retry: 0,
    onSuccess: (result) => {
      setNotice(
        `Anchor ${result.date} disegel dengan ${String(result.count)} event. Root ${result.root.slice(0, 16)}…`,
      );
    },
  });

  const chainFailure = chain.isError ? describeError(chain.error) : null;
  const anchorFailure = anchor.isError ? describeError(anchor.error) : null;
  const result = chain.data;

  return (
    <>
      <div className="page-head">
        <p className="label">Rantai bukti</p>
        <h1 className="page-title">Periksa hash dan segel harian</h1>
        <p className="page-lede">
          Setiap event laporan dirangkai dengan hash sebelumnya. Bila satu baris diubah di database,
          pemeriksaan ini menunjuk laporan dan urutan yang putus.
        </p>
      </div>

      <ConsolePanel title="Verifikasi rantai">
        <p className="console-hint">
          Memeriksa sampai 500 laporan terakhir. Pemeriksaan menyeluruh dijalankan pekerja latar,
          bukan dari peramban.
        </p>

        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={chain.isPending}
            onClick={() => {
              chain.mutate();
            }}
          >
            {chain.isPending ? 'Memeriksa…' : 'Periksa sekarang'}
          </button>
        </div>

        {chainFailure === null ? null : (
          <p className="field-error" role="alert">
            {chainFailure.title}. {chainFailure.detail}
          </p>
        )}

        {result === undefined ? null : (
          <>
            <p className={result.ok ? 'console-notice' : 'field-error'} role="status">
              {result.ok
                ? `Rantai utuh: ${String(result.checkedReports)} laporan, ${String(result.checkedEvents)} event.`
                : `${String(result.breaks.length)} titik putus dari ${String(result.checkedReports)} laporan.`}
            </p>

            {result.breaks.length === 0 ? (
              <ConsoleEmpty>Tidak ada titik putus pada jendela yang diperiksa.</ConsoleEmpty>
            ) : (
              <div className="console-table-wrap">
                <table className="console-table">
                  <thead>
                    <tr>
                      <th scope="col">Laporan</th>
                      <th scope="col">Urutan</th>
                      <th scope="col">Event</th>
                      <th scope="col">Sebab</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.breaks.map((entry) => (
                      <tr key={`${entry.reportPublicId}-${String(entry.seq)}`}>
                        <td>{entry.reportPublicId}</td>
                        <td>{String(entry.seq)}</td>
                        <td>{entry.kind}</td>
                        <td>{entry.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </ConsolePanel>

      <ConsolePanel title="Segel anchor">
        {superadmin ? (
          <>
            <p className="console-hint">
              Anchor hanya bisa disegel untuk hari UTC yang sudah selesai. Root yang sudah
              diterbitkan tidak bisa diganti.
            </p>
            <div className="console-form">
              <div className="field">
                <label htmlFor="anchor-date">Tanggal UTC</label>
                <input
                  id="anchor-date"
                  type="date"
                  value={anchorDate}
                  onChange={(event) => {
                    setAnchorDate(event.target.value);
                    setNotice(null);
                  }}
                />
              </div>
            </div>

            {anchorFailure === null ? null : (
              <p className="field-error" role="alert">
                {anchorFailure.title}. {anchorFailure.detail}
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
                disabled={anchorDate.length === 0 || anchor.isPending}
                onClick={() => {
                  anchor.mutate();
                }}
              >
                {anchor.isPending ? 'Menyegel…' : 'Segel anchor'}
              </button>
            </div>
          </>
        ) : (
          <ConsoleHint>Hanya superadmin yang bisa menyegel anchor.</ConsoleHint>
        )}

        <p className="console-hint">
          Anchor yang sudah disegel bisa diperiksa publik dari halaman transparansi.
        </p>
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/rantai')({
  component: AdminChainPage,
});
