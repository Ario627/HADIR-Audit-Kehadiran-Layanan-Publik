import { createFileRoute } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { MemberPanel } from '../features/partner/MemberPanel';
import { usePartnerProfile } from '../features/partner/use-partner';
import { describeError } from '../lib/errors';

function PartnerMemberPage() {
  const profile = usePartnerProfile();

  if (profile.isPending) {
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>;
  }

  if (profile.isError) {
    const message = describeError(profile.error);
    return (
      <StatePanel tone="error" title={message.title}>
        {message.detail}
      </StatePanel>
    );
  }

  if (profile.data === undefined) {
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>;
  }

  return (
    <>
      <div className="page-head">
        <p className="label">Anggota</p>
        <h1 className="page-title">Siapa yang mewakili instansi</h1>
        <p className="page-lede">
          Setiap tindakan di inbox tercatat atas nama akun yang mengerjakannya. Peran menentukan
          apakah kamu hanya membaca, menanggapi, atau mengelola anggota.
        </p>
      </div>

      <MemberPanel profile={profile.data} />
    </>
  );
}

export const Route = createFileRoute('/partner/anggota')({
  component: PartnerMemberPage,
});
