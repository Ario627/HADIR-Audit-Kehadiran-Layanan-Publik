import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  commitmentStatusLabel,
  dayScopeLabel,
} from '../features/admin/console-ui';
import { fetchCommitmentHistory, fetchCommitments, fetchHolidays } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { stopsQuery } from '../lib/queries';

function CommitmentsPage() {
  const [stopId, setStopId] = useState('');
  const stops = useQuery(stopsQuery({ q: '', limit: 100 }));
  const commitments = useQuery({
    queryKey: ['commitments', stopId],
    queryFn: () => fetchCommitments({ stopId, limit: 50 }),
    enabled: stopId !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['commitments', 'history', stopId],
    queryFn: () => fetchCommitmentHistory(stopId),
    enabled: stopId !== '',
    staleTime: 5 * 60_000,
    retry: false,
  });
  const holidays = useQuery({
    queryKey: ['holidays'],
    queryFn: () => fetchHolidays({}),
    staleTime: 60 * 60_000,
    retry: false,
  });

  return (
    <>
      <div className="page-head">
        <p className="label">Janji layanan</p>
        <h1 className="page-title">Angka yang dijanjikan, bukan angka yang dikarang</h1>
        <p className="page-lede">
          HADIR hanya menilai cepat atau lambat terhadap dokumen resmi. Halaman ini memperlihatkan
          janji mana yang dipakai, sejak kapan, dan dokumen mana yang jadi rujukannya.
        </p>
      </div>

      <section className="console-panel" aria-labelledby="commitment-pick">
        <header className="console-panel-head">
          <h2 className="console-panel-title" id="commitment-pick">
            Pilih halte
          </h2>
        </header>
        {stops.isPending ? (
          <p className="console-hint">Memuat daftar halte.</p>
        ) : stops.isError ? (
          <p className="field-error" role="alert">
            {describeError(stops.error).title}. {describeError(stops.error).detail}
          </p>
        ) : (
          <div className="field">
            <label htmlFor="public-commitment-stop">Halte</label>
            <select
              id="public-commitment-stop"
              value={stopId}
              onChange={(event) => {
                setStopId(event.target.value);
              }}
            >
              <option value="">Pilih halte</option>
              {stops.data.items.map((stop) => (
                <option key={stop.id} value={stop.id}>
                  {stop.code} · {stop.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      {stopId === '' ? null : (
        <section className="console-panel" aria-labelledby="commitment-list">
          <header className="console-panel-head">
            <h2 className="console-panel-title" id="commitment-list">
              Janji tercatat
            </h2>
            <p className="console-panel-meta">
              {commitments.data === undefined ? 'memuat' : `${String(commitments.data.length)} dokumen`}
            </p>
          </header>

          {commitments.isPending ? (
            <p className="console-hint">Memuat janji layanan.</p>
          ) : commitments.isError ? (
            <p className="field-error" role="alert">
              {describeError(commitments.error).title}. {describeError(commitments.error).detail}
            </p>
          ) : commitments.data.length === 0 ? (
            <p className="console-empty">
              Belum ada janji layanan terverifikasi untuk halte ini. Tanpa janji, HADIR tidak
              menyimpulkan apa pun soal ketepatan waktu.
            </p>
          ) : (
            <ul className="queue">
              {commitments.data.map((row) => (
                <li key={row.id} className="queue-row">
                  <div className="queue-main">
                    <span className="queue-title">
                      Headway {row.headwayMin ?? '—'} menit · {dayScopeLabel(row.dayScope)}
                    </span>
                    <span className="queue-text">
                      {row.sourceDocumentTitle ?? 'Dokumen tanpa judul'}
                      {row.sourceDocumentVersion === null ? '' : ` · versi ${row.sourceDocumentVersion}`}
                    </span>
                  </div>
                  <p className="queue-meta">
                    <span className={`chip chip--${row.status === 'verified' ? 'verified' : row.status === 'revoked' ? 'alert' : 'pending'}`}>
                      {commitmentStatusLabel(row.status)}
                    </span>
                    <span>{row.institutionName}</span>
                    <span>
                      berlaku {row.validFrom}
                      {row.validUntil === null ? '' : ` sampai ${row.validUntil}`}
                    </span>
                    <a href={row.sourceDocumentUrl} rel="noreferrer noopener" target="_blank">
                      dokumen sumber
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          )}

          {history.data === undefined || history.data.length === 0 ? null : (
            <details className="console-more">
              <summary>Riwayat perubahan</summary>
              <ol className="changelog-list">
                {history.data.map((change) => (
                  <li key={`${change.validFrom}-${change.sourceDocumentUrl}`} className="changelog-item">
                    <p className="changelog-summary">
                      {change.headwayMin === null
                        ? 'tanpa headway'
                        : `headway ${String(change.headwayMin)} menit`}
                    </p>
                    <p className="changelog-meta">
                      berlaku {change.validFrom}
                      {change.validUntil === null ? '' : ` sampai ${change.validUntil}`}
                      {change.days === null ? '' : ` · ${String(change.days)} hari`}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}

      <section className="console-panel" aria-labelledby="holiday-list">
        <header className="console-panel-head">
          <h2 className="console-panel-title" id="holiday-list">
            Hari libur
          </h2>
          <p className="console-panel-meta">
            {holidays.data === undefined ? 'memuat' : `${String(holidays.data.length)} tanggal`}
          </p>
        </header>

        {holidays.isPending ? (
          <p className="console-hint">Memuat kalender libur.</p>
        ) : holidays.isError ? (
          <p className="field-error" role="alert">
            {describeError(holidays.error).title}. {describeError(holidays.error).detail}
          </p>
        ) : holidays.data.length === 0 ? (
          <p className="console-empty">
            Belum ada hari libur tercatat. Janji yang hanya berlaku pada hari libur tidak bisa
            dicocokkan sampai kalender ini diisi.
          </p>
        ) : (
          <div className="console-table-wrap">
            <table className="console-table">
              <thead>
                <tr>
                  <th scope="col">Tanggal</th>
                  <th scope="col">Nama</th>
                  <th scope="col">Cakupan</th>
                </tr>
              </thead>
              <tbody>
                {holidays.data.map((holiday) => (
                  <tr key={`${holiday.date}-${holiday.name}`}>
                    <td>{holiday.date}</td>
                    <td>
                      <a
                        href={holiday.sourceUrl}
                        rel="noreferrer noopener"
                        target="_blank"
                        className="console-table-link"
                      >
                        {holiday.name}
                      </a>
                    </td>
                    <td>{holiday.scope === 'national' ? 'nasional' : 'kota'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

export const Route = createFileRoute('/komitmen')({
  component: CommitmentsPage,
});
