import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  commitmentStatusLabel,
  dayScopeLabel,
} from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import {
  createCommitment,
  fetchCommitmentHistory,
  fetchCommitments,
  fetchInstitutions,
  revokeCommitment,
  verifyCommitment,
} from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { stopsQuery } from '../lib/queries';

const DAY_SCOPES = ['all', 'weekday', 'weekend', 'holiday'] as const;
const MIN_REVOKE_REASON = 10;

function AdminCommitmentPage() {
  const queryClient = useQueryClient();
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';

  const stops = useQuery(stopsQuery({ q: '', limit: 100 }));
  const institutions = useQuery({
    queryKey: ['institutions', 'list'],
    queryFn: () => fetchInstitutions(),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const [stopId, setStopId] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [headway, setHeadway] = useState('10');
  const [dayScope, setDayScope] = useState<string>('all');
  const [validFrom, setValidFrom] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const commitments = useQuery({
    queryKey: ['admin', 'commitments', stopId],
    queryFn: () => fetchCommitments({ stopId, limit: 50 }),
    enabled: stopId !== '',
    staleTime: 30_000,
    retry: false,
  });
  const history = useQuery({
    queryKey: ['admin', 'commitment-history', stopId],
    queryFn: () => fetchCommitmentHistory(stopId),
    enabled: stopId !== '',
    staleTime: 60_000,
    retry: false,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'commitments', stopId] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'commitment-history', stopId] });
    void queryClient.invalidateQueries({ queryKey: ['evidence', stopId] });
  };

  const create = useMutation({
    mutationFn: () =>
      createCommitment({
        institutionId,
        stopId,
        kind: 'headway',
        dayScope,
        headwayMin: Number(headway),
        sourceDocumentUrl: sourceUrl.trim(),
        sourceDocumentTitle: title.trim().length === 0 ? null : title.trim(),
        sourceDocumentVersion: version.trim().length === 0 ? null : version.trim(),
        validFrom,
        validUntil: validUntil.length === 0 ? null : validUntil,
      }),
    retry: 0,
    onSuccess: (created) => {
      setNotice(`Janji layanan dicatat dengan status ${commitmentStatusLabel(created.status)}. Verifikasi terpisah berlaku untuk mengaktifkannya.`);
      setTitle('');
      setVersion('');
      setSourceUrl('');
      refresh();
    },
  });

  const verify = useMutation({
    mutationFn: (id: string) => verifyCommitment(id),
    retry: 0,
    onSuccess: () => {
      setNotice('Janji layanan ditandai terverifikasi.');
      refresh();
    },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeCommitment(id, revokeReason.trim()),
    retry: 0,
    onSuccess: () => {
      setNotice('Janji layanan dicabut dan tidak dipakai lagi sebagai ambang.');
      setRevoking(null);
      setRevokeReason('');
      refresh();
    },
  });

  const failure =
    create.isError ? describeError(create.error)
      : verify.isError ? describeError(verify.error)
        : revoke.isError ? describeError(revoke.error)
          : null;

  const blocked =
    stopId === '' ||
    institutionId === '' ||
    validFrom.length === 0 ||
    sourceUrl.trim().length === 0 ||
    Number(headway) <= 0 ||
    create.isPending;

  return (
    <>
      <div className="page-head">
        <p className="label">Janji layanan</p>
        <h1 className="page-title">Dokumen yang jadi ambang</h1>
        <p className="page-lede">
          Tanpa janji layanan yang terverifikasi, HADIR menolak menilai cepat atau lambat. Janji
          yang dicatat di sini harus menunjuk dokumen resmi dan baru dipakai setelah diverifikasi.
        </p>
      </div>

      <ConsolePanel title="Pilih halte">
        {stops.isPending ? (
          <ConsoleHint>Memuat daftar halte.</ConsoleHint>
        ) : stops.isError ? (
          <ConsoleFailure
            title={describeError(stops.error).title}
            detail={describeError(stops.error).detail}
            onRetry={() => {
              void stops.refetch();
            }}
          />
        ) : (
          <div className="field">
            <label htmlFor="commitment-stop">Halte</label>
            <select
              id="commitment-stop"
              value={stopId}
              onChange={(event) => {
                setStopId(event.target.value);
                setNotice(null);
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
      </ConsolePanel>

      {stopId === '' ? null : (
        <>
          <ConsolePanel
            title="Janji tercatat"
            meta={commitments.data === undefined ? 'memuat' : `${String(commitments.data.length)} dokumen`}
          >
            {commitments.isPending ? (
              <ConsoleHint>Memuat janji layanan.</ConsoleHint>
            ) : commitments.isError ? (
              <ConsoleFailure
                title={describeError(commitments.error).title}
                detail={describeError(commitments.error).detail}
                onRetry={() => {
                  void commitments.refetch();
                }}
              />
            ) : commitments.data.length === 0 ? (
              <ConsoleEmpty>Belum ada janji layanan untuk halte ini.</ConsoleEmpty>
            ) : (
              <ul className="queue">
                {commitments.data.map((row) => (
                  <li key={row.id} className="queue-row queue-row--stacked">
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
                        dokumen
                      </a>
                    </p>

                    {superadmin && row.status === 'draft' ? (
                      <div className="queue-actions">
                        <button
                          type="button"
                          className="link-button"
                          disabled={verify.isPending}
                          onClick={() => {
                            verify.mutate(row.id);
                          }}
                        >
                          Verifikasi
                        </button>
                      </div>
                    ) : null}

                    {superadmin && row.status !== 'revoked' ? (
                      revoking === row.id ? (
                        <div className="console-inline">
                          <div className="field">
                            <label htmlFor={`revoke-${row.id}`}>Alasan pencabutan</label>
                            <textarea
                              id={`revoke-${row.id}`}
                              rows={2}
                              maxLength={500}
                              value={revokeReason}
                              onChange={(event) => {
                                setRevokeReason(event.target.value);
                              }}
                            />
                            <p className="field-hint">
                              Minimal {MIN_REVOKE_REASON} karakter. Alasan masuk ke log audit.
                            </p>
                          </div>
                          <div className="actions">
                            <button
                              type="button"
                              className="btn btn--danger"
                              disabled={revoke.isPending || revokeReason.trim().length < MIN_REVOKE_REASON}
                              onClick={() => {
                                revoke.mutate(row.id);
                              }}
                            >
                              {revoke.isPending ? 'Mencabut…' : 'Cabut janji'}
                            </button>
                            <button
                              type="button"
                              className="btn btn--ghost"
                              onClick={() => {
                                setRevoking(null);
                                setRevokeReason('');
                              }}
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="queue-actions">
                          <button
                            type="button"
                            className="link-button"
                            onClick={() => {
                              setRevoking(row.id);
                            }}
                          >
                            Cabut
                          </button>
                        </div>
                      )
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ConsolePanel>

          {history.data === undefined || history.data.length === 0 ? null : (
            <ConsolePanel title="Riwayat perubahan">
              <ol className="changelog-list">
                {history.data.map((change) => (
                  <li key={`${change.validFrom}-${change.sourceDocumentUrl}`} className="changelog-item">
                    <p className="changelog-summary">
                      {change.headwayMin === null ? 'tanpa headway' : `headway ${String(change.headwayMin)} menit`}
                    </p>
                    <p className="changelog-meta">
                      berlaku {change.validFrom}
                      {change.validUntil === null ? '' : ` sampai ${change.validUntil}`}
                      {change.days === null ? '' : ` · ${String(change.days)} hari`}
                      {change.sourceDocumentVersion === null ? '' : ` · versi ${change.sourceDocumentVersion}`}
                    </p>
                  </li>
                ))}
              </ol>
            </ConsolePanel>
          )}

          <ConsolePanel title="Catat janji baru">
            {institutions.isPending ? (
              <ConsoleHint>Memuat daftar instansi.</ConsoleHint>
            ) : institutions.isError ? (
              <ConsoleFailure
                title={describeError(institutions.error).title}
                detail={describeError(institutions.error).detail}
                onRetry={() => {
                  void institutions.refetch();
                }}
              />
            ) : (
              <>
                <div className="console-form">
                  <div className="field">
                    <label htmlFor="commitment-institution">Instansi penerbit</label>
                    <select
                      id="commitment-institution"
                      value={institutionId}
                      onChange={(event) => {
                        setInstitutionId(event.target.value);
                      }}
                    >
                      <option value="">Pilih instansi</option>
                      {institutions.data.items.map((entry) => (
                        <option key={entry.institutionId} value={entry.institutionId}>
                          {entry.institutionName}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="commitment-headway">Headway (menit)</label>
                    <input
                      id="commitment-headway"
                      type="number"
                      min={1}
                      max={240}
                      value={headway}
                      onChange={(event) => {
                        setHeadway(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="commitment-day">Cakupan hari</label>
                    <select
                      id="commitment-day"
                      value={dayScope}
                      onChange={(event) => {
                        setDayScope(event.target.value);
                      }}
                    >
                      {DAY_SCOPES.map((entry) => (
                        <option key={entry} value={entry}>
                          {dayScopeLabel(entry)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="commitment-from">Berlaku sejak</label>
                    <input
                      id="commitment-from"
                      type="date"
                      value={validFrom}
                      onChange={(event) => {
                        setValidFrom(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="commitment-until">Berlaku sampai</label>
                    <input
                      id="commitment-until"
                      type="date"
                      value={validUntil}
                      onChange={(event) => {
                        setValidUntil(event.target.value);
                      }}
                    />
                  </div>
                </div>

                <div className="field">
                  <label htmlFor="commitment-source">URL dokumen resmi</label>
                  <input
                    id="commitment-source"
                    type="url"
                    maxLength={500}
                    placeholder="https://"
                    value={sourceUrl}
                    onChange={(event) => {
                      setSourceUrl(event.target.value);
                    }}
                  />
                  <p className="field-hint">
                    Dibuka publik dari panel dasar bukti. Tanpa dokumen, janji tidak bisa diverifikasi.
                  </p>
                </div>

                <div className="console-form">
                  <div className="field">
                    <label htmlFor="commitment-title">Judul dokumen</label>
                    <input
                      id="commitment-title"
                      type="text"
                      maxLength={200}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                      }}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="commitment-version">Versi</label>
                    <input
                      id="commitment-version"
                      type="text"
                      maxLength={80}
                      value={version}
                      onChange={(event) => {
                        setVersion(event.target.value);
                      }}
                    />
                  </div>
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
                      create.mutate();
                    }}
                  >
                    {create.isPending ? 'Menyimpan…' : 'Catat janji'}
                  </button>
                </div>
              </>
            )}
          </ConsolePanel>
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/admin/komitmen')({
  component: AdminCommitmentPage,
});
