import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  fetchAdminPanel,
  fetchPanelCandidates,
  invitePanelMember,
  revokePanelMember,
} from '../../lib/admin-api';
import { describeError } from '../../lib/errors';
import { ConsoleEmpty, ConsoleFailure, ConsoleHint, ConsolePanel } from './console-ui';


export function PanelAdmin({ publicId }: { publicId: string }) {
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState('');
  const [role, setRole] = useState<'verifier' | 'observer'>('verifier');
  const [notice, setNotice] = useState<string | null>(null);

  const panel = useQuery({
    queryKey: ['admin', 'panel', publicId],
    queryFn: () => fetchAdminPanel(publicId),
    staleTime: 20_000,
    retry: false,
  });
  const candidates = useQuery({
    queryKey: ['admin', 'panel-candidates', publicId],
    queryFn: () => fetchPanelCandidates(publicId),
    staleTime: 20_000,
    retry: false,
  });

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['admin', 'panel', publicId] });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'panel-candidates', publicId] });
    void queryClient.invalidateQueries({ queryKey: ['case', publicId] });
  };

  const invite = useMutation({
    mutationFn: (input: { institutionId: string; role: string }) =>
      invitePanelMember(publicId, input),
    retry: 0,
    onSuccess: () => {
      setNotice('Undangan panel dicatat. Instansi perlu menerima sebelum bisa memutuskan.');
      setChosen('');
      refresh();
    },
  });

  const revoke = useMutation({
    mutationFn: (institutionId: string) => revokePanelMember(publicId, institutionId),
    retry: 0,
    onSuccess: () => {
      setNotice('Keanggotaan panel dicabut.');
      refresh();
    },
  });

  const failure =
    invite.isError ? describeError(invite.error) : revoke.isError ? describeError(revoke.error) : null;

  const eligible = candidates.data?.candidates.filter((entry) => entry.eligible) ?? [];

  return (
    <ConsolePanel
      title="Panel independen"
      meta={panel.data === undefined ? 'memuat' : panel.data.summary}
    >
      {panel.isPending ? (
        <ConsoleHint>Memuat susunan panel.</ConsoleHint>
      ) : panel.isError ? (
        <ConsoleFailure
          title={describeError(panel.error).title}
          detail={describeError(panel.error).detail}
          onRetry={() => {
            void panel.refetch();
          }}
        />
      ) : (
        <>
          <p className="console-kv">
            <span>Kuorum</span>
            <span>
              {String(panel.data.quorum.present)} dari {String(panel.data.quorum.required)} ·{' '}
              {panel.data.quorum.met ? 'terpenuhi' : `kurang ${String(panel.data.quorum.missing)}`}
            </span>
          </p>
          <p className="console-kv">
            <span>Kekuatan panel</span>
            <span>{panel.data.strength}</span>
          </p>
          <p className="console-kv">
            <span>Klaim dari</span>
            <span>{panel.data.claimantInstitutionName}</span>
          </p>

          {panel.data.grants.length === 0 ? (
            <ConsoleEmpty>Belum ada instansi yang diundang ke panel laporan ini.</ConsoleEmpty>
          ) : (
            <ul className="queue">
              {panel.data.grants.map((grant) => (
                <li key={grant.id} className="queue-row">
                  <div className="queue-main">
                    <span className="queue-title">{grant.institutionName}</span>
                    <span className="queue-meta">
                      <span>{grant.role === 'verifier' ? 'pemutus' : 'pengamat'}</span>
                      <span className={`chip chip--${grant.status === 'active' ? 'verified' : 'pending'}`}>
                        {grant.status}
                      </span>
                      {grant.isOwnInstitution ? <span>instansi pengklaim</span> : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="link-button"
                    disabled={revoke.isPending}
                    onClick={() => {
                      revoke.mutate(grant.institutionId);
                    }}
                  >
                    Cabut
                  </button>
                </li>
              ))}
            </ul>
          )}

          {panel.data.caveats.length === 0 ? null : (
            <details className="console-more">
              <summary>Catatan panel</summary>
              <ul className="dossier-list">
                {panel.data.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </details>
          )}

          <div className="console-form">
            <div className="field">
              <label htmlFor="panel-candidate">Instansi yang diundang</label>
              <select
                id="panel-candidate"
                value={chosen}
                onChange={(event) => {
                  setChosen(event.target.value);
                  setNotice(null);
                }}
              >
                <option value="">Pilih instansi</option>
                {eligible.map((entry) => (
                  <option key={entry.institutionId} value={entry.institutionId}>
                    {entry.displayName}
                  </option>
                ))}
              </select>
              <p className="field-hint">
                {candidates.isPending
                  ? 'Memeriksa calon panel.'
                  : eligible.length === 0
                    ? 'Tidak ada instansi yang memenuhi syarat untuk laporan ini.'
                    : `${String(eligible.length)} instansi memenuhi syarat kota dan bukan pengklaim.`}
              </p>
            </div>

            <div className="field">
              <label htmlFor="panel-role">Peran</label>
              <select
                id="panel-role"
                value={role}
                onChange={(event) => {
                  setRole(event.target.value === 'observer' ? 'observer' : 'verifier');
                }}
              >
                <option value="verifier">Pemutus</option>
                <option value="observer">Pengamat</option>
              </select>
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
              disabled={chosen === '' || invite.isPending}
              onClick={() => {
                invite.mutate({ institutionId: chosen, role });
              }}
            >
              {invite.isPending ? 'Mengundang…' : 'Undang ke panel'}
            </button>
          </div>
        </>
      )}
    </ConsolePanel>
  );
}
