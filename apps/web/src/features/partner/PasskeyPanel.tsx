import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { passkeyDeviceLabel, passkeyUsedText, type PartnerAbilities } from '../../lib/partner';
import {
  beginPasskeyRegistration,
  finishPasskeyRegistration,
  passkeyListQuery,
  removePasskey,
} from '../../lib/partner-api';
import {
  describePasskeyError,
  enrolPasskey,
  passkeyAvailable,
  passkeyFailureText,
  type PasskeyFailure,
} from '../../lib/passkey';

export interface PasskeyPanelProps {
  abilities: PartnerAbilities;
  now: number;
}

export function PasskeyPanel({ abilities, now }: PasskeyPanelProps) {
  const queryClient = useQueryClient();
  const list = useQuery(passkeyListQuery());
  const [supported, setSupported] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<PasskeyFailure | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void passkeyAvailable().then((value) => {
      if (alive) {
        setSupported(value);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const enrol = useMutation({
    mutationFn: async () => {
      const challenge = await beginPasskeyRegistration();
      const result = await enrolPasskey(challenge.options);
      if (result.kind !== 'ok') {
        throw Object.assign(new Error(passkeyFailureText(result)), { passkey: result });
      }
      await finishPasskeyRegistration(
        challenge.challengeId,
        result.response as unknown as Record<string, unknown>,
      );
    },
    retry: 0,
    onSuccess: () => {
      setFailure(null);
      setRegisterError(null);
      void queryClient.invalidateQueries({ queryKey: ['partner', 'passkeys'] });
    },
    onError: (error) => {
      const tagged = (error as { passkey?: PasskeyFailure }).passkey;
      if (tagged !== undefined) {
        setFailure(tagged);
        return;
      }
      setFailure(null);
      setRegisterError(describeError(error).detail);
    },
  });

  const remove = useMutation({
    mutationFn: (passkeyId: string) => removePasskey(passkeyId),
    retry: 0,
    onSuccess: () => {
      setConfirmRemove(null);
      void queryClient.invalidateQueries({ queryKey: ['partner', 'passkeys'] });
    },
  });

  const removeError = remove.isError ? describeError(remove.error) : null;
  const removeForbidden = isApiError(remove.error) && remove.error.code === 'FORBIDDEN';
  const items = list.data ?? [];

  return (
    <section className="settings-block" aria-labelledby="passkey-title">
      <h2 className="section-title" id="passkey-title">
        Passkey
      </h2>
      <p className="settings-meta">
        Passkey mengikat akunmu ke perangkat atau pengelola kata sandi yang mendukung WebAuthn. Kunci
        privat tidak pernah meninggalkan perangkat; server hanya menyimpan kunci publik.
      </p>

      {list.isPending ? (
        <p className="note">Memuat daftar passkey.</p>
      ) : list.isError ? (
        <p className="note">{describeError(list.error).detail}</p>
      ) : items.length === 0 ? (
        <p className="note">Belum ada passkey terdaftar untuk akun ini.</p>
      ) : (
        <ul className="passkey-list">
          {items.map((item) => (
            <li key={item.id} className="passkey-item">
              <div>
                <span className="passkey-name">{passkeyDeviceLabel(item.deviceType)}</span>
                <span className="passkey-meta">{passkeyUsedText(item.lastUsedAt, now)}</span>
              </div>
              {abilities.removePasskey ? (
                confirmRemove === item.id ? (
                  <div className="actions">
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={remove.isPending}
                      onClick={() => {
                        remove.mutate(item.id);
                      }}
                    >
                      {remove.isPending ? 'Menghapus' : 'Hapus sekarang'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost"
                      onClick={() => {
                        setConfirmRemove(null);
                      }}
                    >
                      Batal
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setConfirmRemove(item.id);
                    }}
                  >
                    Hapus passkey
                  </button>
                )
              ) : (
                <p className="settings-meta">Hanya admin instansi yang bisa menghapus passkey.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {removeError === null ? null : (
        <div className="alert-box" role="alert">
          <p>{removeError.detail}</p>
          {removeForbidden ? <p>Minta admin instansi menghapus passkey ini.</p> : null}
        </div>
      )}

      {supported === false ? (
        <p className="note" role="status">
          Peramban ini tidak mendukung passkey. Daftar passkey yang sudah ada tetap bisa kamu lihat.
        </p>
      ) : null}

      {supported === true ? (
        <div className="actions">
          <button
            type="button"
            className="btn"
            disabled={enrol.isPending}
            aria-busy={enrol.isPending}
            onClick={() => {
              setFailure(null);
              setRegisterError(null);
              enrol.mutate();
            }}
          >
            {enrol.isPending ? 'Menunggu perangkat' : 'Daftarkan passkey di perangkat ini'}
          </button>
        </div>
      ) : null}

      {failure === null ? null : (
        <p className="note" role="alert">
          {passkeyFailureText(failure)}
        </p>
      )}

      {registerError === null ? null : (
        <div className="alert-box" role="alert">
          <p>{registerError}</p>
        </div>
      )}

      <p className="note">
        Pendaftaran passkey di halaman ini sudah menyimpan kredensial di server, tetapi halaman masuk
        belum memakai passkey sebagai faktor utama. Server belum menaikkan tingkat jaminan sesi setelah
        verifikasi passkey, jadi menampilkan tombol &quot;masuk dengan passkey&quot; sekarang hanya akan
        menyesatkan. Panel ini disediakan supaya akun siap begitu jalur itu selesai.
      </p>

      {enrol.isError && (enrol.error as { passkey?: PasskeyFailure }).passkey === undefined ? (
        <p className="settings-meta">{describePasskeyError(enrol.error)}</p>
      ) : null}
    </section>
  );
}