import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { PasskeyPanel } from '../features/partner/PasskeyPanel';
import { PasswordChange } from '../features/partner/PasswordChange';
import { ProfileCard } from '../features/partner/ProfileCard';
import { SessionPanel } from '../features/partner/SessionPanel';
import { usePartnerProfile } from '../features/partner/use-partner';
import { describeError } from '../lib/errors';
import { abilitiesFor } from '../lib/partner';
import { partnerSessionQuery } from '../lib/partner-api';

function PartnerSettingsPage() {
  const profile = usePartnerProfile();
  const session = useQuery(partnerSessionQuery());
  const now = Date.now();

  if (profile.isPending) {
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>;
  }

  if (profile.isError) {
    const message = describeError(profile.error);
    return (
      <>
        <StatePanel tone="error" title={message.title}>
          {message.detail}
        </StatePanel>
        <div className="actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              void profile.refetch();
            }}
          >
            Coba lagi
          </button>
        </div>
      </>
    );
  }

  if (profile.data === undefined) {
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>;
  }

  const abilities = abilitiesFor(profile.data.role);

  return (
    <>
      <div className="page-head">
        <p className="label">Pengaturan</p>
        <h1 className="page-title">Akun instansimu</h1>
        <p className="page-lede">
          Semua yang bisa diubah dari akun mitra ada di halaman ini: kata sandi, passkey, dan sesi aktif.
          Perubahan wewenang dan data instansi tidak tersedia di sini karena harus lewat jalur yang
          teraudit.
        </p>
      </div>

      <div className="settings">
        <ProfileCard
          profile={profile.data}
          sessionCreatedAt={session.data?.createdAt ?? null}
          now={now}
        />
        <PasswordChange />
        <PasskeyPanel abilities={abilities} now={now} />
        <SessionPanel abilities={abilities} now={now} />
      </div>
    </>
  );
}

export const Route = createFileRoute('/partner/pengaturan')({
  component: PartnerSettingsPage,
});