import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { LoginPanel } from '../features/partner/LoginPanel';
import { usePartnerProfile } from '../features/partner/use-partner';
import { partnerTargetFor, type PartnerTarget } from '../lib/partner';

export interface MasukSearch {
  next?: string;
}

function readMasukSearch(raw: Record<string, unknown>): MasukSearch {
  const target = partnerTargetFor(raw.next);
  return target === null ? {} : { next: target };
}

function MasukPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const profile = usePartnerProfile();
  const target: PartnerTarget = partnerTargetFor(search.next) ?? '/partner';

  useEffect(() => {
    if (profile.data === undefined) {
      return;
    }
    void navigate({ to: target, replace: true });
  }, [profile.data, target, navigate]);

  return (
    <>
      <div className="page-head">
        <p className="label">Mitra</p>
        <h1 className="page-title">Masuk ke inbox instansi</h1>
        <p className="page-lede">
          Halaman ini hanya untuk petugas instansi yang sudah diundang. Data warga di inbox tidak
          ditampilkan ke publik, dan sesi mitra disimpan sebagai cookie HttpOnly yang tidak bisa dibaca
          JavaScript.
        </p>
      </div>

      {profile.data === undefined ? (
        <LoginPanel
          onDone={() => {
            void navigate({ to: target, replace: true });
          }}
        />
      ) : (
        <p className="note" role="status">
          Sesi masih aktif. Mengalihkan ke halaman mitra.
        </p>
      )}

      <p className="note">
        Lupa kata sandi? Minta admin instansimu mengirim ulang undangan; HADIR tidak menampilkan formulir
        pemulihan sendiri untuk mencegah penebakan akun.
      </p>
    </>
  );
}

export const Route = createFileRoute('/masuk')({
  validateSearch: (raw: Record<string, unknown>): MasukSearch => readMasukSearch(raw),
  component: MasukPage,
});