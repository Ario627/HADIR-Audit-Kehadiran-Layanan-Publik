import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  hoursText,
  priorityLabel,
  slaPhaseLabel,
} from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import {
  fetchAdminCities,
  fetchCitySla,
  fetchSlaBreaches,
  setCitySla,
} from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/time';

const PRIORITIES = ['normal', 'high', 'critical', 'low'] as const;

function AdminSlaPage() {
  const queryClient = useQueryClient();
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';

  const cities = useQuery({
    queryKey: ['admin', 'cities'],
    queryFn: () => fetchAdminCities(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const [cityId, setCityId] = useState('');
  const overrides = useQuery({
    queryKey: ['admin', 'city-sla', cityId],
    queryFn: () => fetchCitySla(cityId),
    enabled: cityId !== '',
    staleTime: 30_000,
    retry: false,
  });
  const breaches = useQuery({
    queryKey: ['admin', 'sla-breaches', 1],
    queryFn: () => fetchSlaBreaches({ minEscalation: 1, limit: 40 }),
    staleTime: 30_000,
    retry: false,
  });

  const [priority, setPriority] = useState<string>('normal');
  const [acknowledge, setAcknowledge] = useState('24');
  const [respond, setRespond] = useState('72');
  const [resolve, setResolve] = useState('168');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      setCitySla(cityId, {
        priority,
        acknowledgeHours: Number(acknowledge),
        respondHours: Number(respond),
        resolveHours: Number(resolve),
        sourceUrl: sourceUrl.trim(),
        note: note.trim().length === 0 ? null : note.trim(),
      }),
    retry: 0,
    onSuccess: (row) => {
      setNotice(`Tenggat ${row.cityName} disimpan: ${hoursText(row.acknowledgeHours)} / ${hoursText(row.respondHours)} / ${hoursText(row.resolveHours)}.`);
      void queryClient.invalidateQueries({ queryKey: ['admin', 'city-sla', cityId] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'sla-breaches'] });
    },
  });

  const failure = save.isError ? describeError(save.error) : null;
  const ordered = Number(acknowledge) <= Number(respond) && Number(respond) <= Number(resolve);
  const blocked = cityId === '' || sourceUrl.trim().length === 0 || !ordered || save.isPending;

  return (
    <>
      <div className="page-head">
        <p className="label">SLA</p>
        <h1 className="page-title">Tenggat per kota dan pelanggarannya</h1>
        <p className="page-lede">
          Tenggat bawaan berlaku bila kota tidak punya override. Override harus menyebut dokumen
          sumber supaya angka ini bisa diperiksa siapa pun.
        </p>
      </div>

      <ConsolePanel
        title="Pelanggaran tenggat"
        meta={breaches.data === undefined ? 'memuat' : `${String(breaches.data.length)} baris`}
      >
        {breaches.isPending ? (
          <ConsoleHint>Memuat pelanggaran.</ConsoleHint>
        ) : breaches.isError ? (
          <ConsoleFailure
            title={describeError(breaches.error).title}
            detail={describeError(breaches.error).detail}
            onRetry={() => {
              void breaches.refetch();
            }}
          />
        ) : breaches.data.length === 0 ? (
          <ConsoleEmpty>Tidak ada tenggat yang terlewat.</ConsoleEmpty>
        ) : (
          <div className="console-table-wrap">
            <table className="console-table">
              <thead>
                <tr>
                  <th scope="col">Laporan</th>
                  <th scope="col">Instansi</th>
                  <th scope="col">Fase</th>
                  <th scope="col">Lewat</th>
                  <th scope="col">Prioritas</th>
                  <th scope="col">Eskalasi</th>
                </tr>
              </thead>
              <tbody>
                {breaches.data.map((row) => (
                  <tr key={`${row.publicId}-${row.phase}`}>
                    <td>
                      <Link
                        to="/admin/laporan/$publicId"
                        params={{ publicId: row.publicId }}
                        className="console-table-link"
                      >
                        {row.publicId}
                      </Link>
                      <span className="console-table-sub">{slaPhaseLabel(row.phase)}</span>
                    </td>
                    <td>{row.institutionName ?? 'tanpa instansi'}</td>
                    <td>{slaPhaseLabel(row.phase)}</td>
                    <td>
                      {hoursText(row.hoursLate)}
                      <span className="console-table-sub">{formatDateTime(row.dueAt)}</span>
                    </td>
                    <td>{priorityLabel(row.priority)}</td>
                    <td>
                      <span className={`chip chip--${row.escalation >= 2 ? 'alert' : 'pending'}`}>
                        {String(row.escalation)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ConsolePanel>

      <ConsolePanel title="Override tenggat kota">
        {cities.isPending ? (
          <ConsoleHint>Memuat daftar kota.</ConsoleHint>
        ) : cities.isError ? (
          <ConsoleFailure
            title={describeError(cities.error).title}
            detail={describeError(cities.error).detail}
            onRetry={() => {
              void cities.refetch();
            }}
          />
        ) : (
          <>
            <div className="field">
              <label htmlFor="sla-city">Kota</label>
              <select
                id="sla-city"
                value={cityId}
                onChange={(event) => {
                  setCityId(event.target.value);
                  setNotice(null);
                }}
              >
                <option value="">Pilih kota</option>
                {cities.data.items.map((city) => (
                  <option key={city.id} value={city.id}>
                    {city.name} · {city.code}
                  </option>
                ))}
              </select>
            </div>

            {cityId === '' ? (
              <ConsoleHint>Pilih kota untuk melihat override yang berlaku.</ConsoleHint>
            ) : overrides.isPending ? (
              <ConsoleHint>Memuat override kota.</ConsoleHint>
            ) : overrides.isError ? (
              <ConsoleFailure
                title={describeError(overrides.error).title}
                detail={describeError(overrides.error).detail}
                onRetry={() => {
                  void overrides.refetch();
                }}
              />
            ) : overrides.data.length === 0 ? (
              <ConsoleEmpty>Kota ini memakai tenggat bawaan.</ConsoleEmpty>
            ) : (
              <ul className="queue">
                {overrides.data.map((row) => (
                  <li key={`${row.cityId}-${row.priority}`} className="queue-row">
                    <div className="queue-main">
                      <span className="queue-title">{priorityLabel(row.priority)}</span>
                      <span className="queue-text">
                        {hoursText(row.acknowledgeHours)} / {hoursText(row.respondHours)} /{' '}
                        {hoursText(row.resolveHours)}
                      </span>
                    </div>
                    <p className="queue-meta">
                      <a href={row.sourceUrl} rel="noreferrer noopener" target="_blank">
                        dokumen sumber
                      </a>
                      {row.note === null ? null : <span>{row.note}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}

            {superadmin ? (
              <>
                <div className="console-form">
                  <div className="field">
                    <label htmlFor="sla-priority">Prioritas</label>
                    <select
                      id="sla-priority"
                      value={priority}
                      onChange={(event) => {
                        setPriority(event.target.value);
                      }}
                    >
                      {PRIORITIES.map((entry) => (
                        <option key={entry} value={entry}>
                          {priorityLabel(entry)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="sla-ack">Jam pengakuan</label>
                    <input
                      id="sla-ack"
                      type="number"
                      min={1}
                      max={2160}
                      value={acknowledge}
                      onChange={(event) => {
                        setAcknowledge(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sla-respond">Jam tanggapan</label>
                    <input
                      id="sla-respond"
                      type="number"
                      min={1}
                      max={2160}
                      value={respond}
                      onChange={(event) => {
                        setRespond(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="sla-resolve">Jam penyelesaian</label>
                    <input
                      id="sla-resolve"
                      type="number"
                      min={1}
                      max={8760}
                      value={resolve}
                      onChange={(event) => {
                        setResolve(event.target.value);
                      }}
                    />
                  </div>
                </div>

                {ordered ? null : (
                  <p className="field-error" role="alert">
                    Urutan tenggat harus pengakuan ≤ tanggapan ≤ penyelesaian.
                  </p>
                )}

                <div className="field">
                  <label htmlFor="sla-source">URL dokumen sumber</label>
                  <input
                    id="sla-source"
                    type="url"
                    maxLength={500}
                    placeholder="https://"
                    value={sourceUrl}
                    onChange={(event) => {
                      setSourceUrl(event.target.value);
                    }}
                  />
                  <p className="field-hint">
                    Tautan ke peraturan atau kontrak yang menetapkan tenggat ini.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="sla-note">Catatan</label>
                  <input
                    id="sla-note"
                    type="text"
                    maxLength={500}
                    value={note}
                    onChange={(event) => {
                      setNote(event.target.value);
                    }}
                  />
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
                      save.mutate();
                    }}
                  >
                    {save.isPending ? 'Menyimpan…' : 'Simpan override'}
                  </button>
                </div>
              </>
            ) : (
              <ConsoleHint>
                Hanya superadmin yang bisa mengubah override tenggat kota.
              </ConsoleHint>
            )}
          </>
        )}
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/sla')({
  component: AdminSlaPage,
});
