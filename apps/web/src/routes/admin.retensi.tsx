import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
} from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import { fetchRetention, fetchRetentionRuns, runRetention } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/time';

function AdminRetentionPage() {
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';
  const [notice, setNotice] = useState<string | null>(null);

  const policy = useQuery({
    queryKey: ['admin', 'retention'],
    queryFn: () => fetchRetention(),
    staleTime: 60_000,
    retry: false,
  });
  const runs = useQuery({
    queryKey: ['admin', 'retention-runs'],
    queryFn: () => fetchRetentionRuns(),
    staleTime: 60_000,
    retry: false,
  });

  const run = useMutation({
    mutationFn: () => runRetention(),
    retry: 0,
    onSuccess: (result) => {
      setNotice(`Retensi dijalankan: ${String(result.deleted)} baris dihapus dari ${String(result.tables)} tabel.`);
      void runs.refetch();
      void policy.refetch();
    },
  });

  const failure = run.isError ? describeError(run.error) : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Retensi</p>
        <h1 className="page-title">Umur simpan data</h1>
        <p className="page-lede">
          Data yang sudah lewat masa simpan dihapus, kecuali yang dilindungi karena masih dipakai
          kasus berjalan atau kewajiban audit.
        </p>
      </div>

      <ConsolePanel title="Kebijakan aktif">
        {policy.isPending ? (
          <ConsoleHint>Memuat kebijakan retensi.</ConsoleHint>
        ) : policy.isError ? (
          <ConsoleFailure
            title={describeError(policy.error).title}
            detail={describeError(policy.error).detail}
            onRetry={() => {
              void policy.refetch();
            }}
          />
        ) : (
          <>
            <p className="console-kv">
              <span>Versi</span>
              <span>{policy.data.version}</span>
            </p>
            <p className="console-kv">
              <span>Dataset terhapus otomatis</span>
              <span>{String(policy.data.actionable)}</span>
            </p>
            <p className="console-kv">
              <span>Baris terlindungi</span>
              <span>{String(policy.data.protectedCount)}</span>
            </p>
            <details className="console-more">
              <summary>Aturan per dataset</summary>
              <ul className="dossier-list">
                {policy.data.description.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>

            {policy.data.decisions.length === 0 ? (
              <ConsoleEmpty>Tidak ada keputusan retensi pada putaran ini.</ConsoleEmpty>
            ) : (
              <div className="console-table-wrap">
                <table className="console-table">
                  <thead>
                    <tr>
                      <th scope="col">Dataset</th>
                      <th scope="col">Tindakan</th>
                      <th scope="col">Umur</th>
                      <th scope="col">Batas waktu</th>
                    </tr>
                  </thead>
                  <tbody>
                    {policy.data.decisions.map((entry) => (
                      <tr key={entry.dataset}>
                        <td>
                          {entry.dataset}
                          <span className="console-table-sub">
                            {entry.reason ?? 'tanpa alasan tertulis'}
                          </span>
                        </td>
                        <td>
                          {entry.action}
                          {entry.overridden ? (
                            <span className="console-table-sub">override aktif</span>
                          ) : null}
                          {entry.rejectedOverride === null ? null : (
                            <span className="console-table-sub">{entry.rejectedOverride}</span>
                          )}
                        </td>
                        <td>{entry.effectiveDays === null ? 'permanen' : `${String(entry.effectiveDays)} hari`}</td>
                        <td>{entry.cutoff === null ? '—' : formatDateTime(entry.cutoff)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {policy.data.warnings.length === 0 ? null : (
              <details className="console-more">
                <summary>Peringatan</summary>
                <ul className="dossier-list">
                  {policy.data.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </ConsolePanel>

      <ConsolePanel title="Putaran terakhir">
        {runs.isPending ? (
          <ConsoleHint>Memuat riwayat putaran.</ConsoleHint>
        ) : runs.isError ? (
          <ConsoleFailure
            title={describeError(runs.error).title}
            detail={describeError(runs.error).detail}
            onRetry={() => {
              void runs.refetch();
            }}
          />
        ) : runs.data.length === 0 ? (
          <ConsoleEmpty>Retensi belum pernah dijalankan.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {runs.data.map((entry) => (
              <li key={entry.startedAt} className="queue-row">
                <div className="queue-main">
                  <span className="queue-title">{formatDateTime(entry.startedAt)}</span>
                  <span className="queue-text">
                    {String(entry.rowsRemoved)} baris dihapus · dipicu {entry.triggeredBy}
                    {entry.errorCode === null ? '' : ` · gagal: ${entry.errorCode}`}
                  </span>
                </div>
                {entry.finishedAt === null ? null : (
                  <p className="queue-meta">selesai {formatDateTime(entry.finishedAt)}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      {superadmin ? (
        <ConsolePanel title="Jalankan sekarang">
          <p className="console-hint">
            Putaran manual memakai kebijakan yang sama dengan pekerja terjadwal. Tidak ada opsi
            melewati perlindungan data kasus berjalan.
          </p>

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
              className="btn btn--danger"
              disabled={run.isPending}
              onClick={() => {
                run.mutate();
              }}
            >
              {run.isPending ? 'Menjalankan…' : 'Jalankan retensi'}
            </button>
          </div>
        </ConsolePanel>
      ) : (
        <ConsolePanel title="Jalankan sekarang">
          <ConsoleHint>Hanya superadmin yang bisa menjalankan retensi manual.</ConsoleHint>
        </ConsolePanel>
      )}
    </>
  );
}

export const Route = createFileRoute('/admin/retensi')({
  component: AdminRetentionPage,
});
