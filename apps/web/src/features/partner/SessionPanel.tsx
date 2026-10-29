import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { sessionAgeText, type PartnerAbilities } from '../../lib/partner';
import { partnerSessionQuery, revokeAllPartnerSessions } from '../../lib/partner-api';

export interface SessionPanelProps {
  abilities: PartnerAbilities;
  now: number;
}

export function SessionPanel({ abilities, now }: SessionPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery(partnerSessionQuery());
  const [confirming, setConfirming] = useState(false);

  const revoke = useMutation({
    mutationFn: () => revokeAllPartnerSessions(),
    retry: 0,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['partner'] });
      void navigate({ to: '/masuk', replace: true });
    },
  });

  const errorMessage = revoke.isError ? describeError(revoke.error) : null;
  const staleSession = isApiError(revoke.error) && revoke.error.code === 'FORBIDDEN';

  return (
    <section className="settings-block" aria-labelledby="session-title">
      <h2 className="section-title" id="session-title">
        Sesi aktif
      </h2>
      <p className="settings-meta">
        {session.data === undefined
          ? 'Umur sesi tidak tersedia.'
          : sessionAgeText(session.data.createdAt, now)}
        . Aksi yang mengubah kredensial hanya diterima server bila sesimu masih baru.
      </p>

      {abilities.revokeSessions ? (
        <>
          {confirming ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn--danger"
                disabled={revoke.isPending}
                onClick={() => {
                  revoke.mutate();
                }}
              >
                {revoke.isPending ? 'Memutus' : 'Ya, putus semua sesi'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Batal
              </button>
            </div>
          ) : (
            <div className="actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  setConfirming(true);
                }}
              >
                Putus semua sesi instansi ini
              </button>
            </div>
          )}
          <p className="note">
            Semua perangkat yang memakai akunmu akan keluar, termasuk perangkat ini. Kamu perlu masuk
            ulang setelah itu.
          </p>
        </>
      ) : (
        <p className="note">
          Memutus seluruh sesi hanya bisa dilakukan admin instansi. Kalau kamu merasa akunmu dipakai orang
          lain, laporkan ke admin dan ganti kata sandi di blok di atas.
        </p>
      )}

      {errorMessage === null ? null : (
        <div className="alert-box" role="alert">
          <p>{errorMessage.detail}</p>
          {staleSession ? <p>Masuk ulang dulu, lalu ulangi aksi ini.</p> : null}
        </div>
      )}
    </section>
  );
}