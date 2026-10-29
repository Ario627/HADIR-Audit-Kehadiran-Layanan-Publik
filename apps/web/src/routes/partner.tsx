import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { StatePanel } from '../components/StatePanel';
import { PartnerBar } from '../features/partner/PartnerBar';
import { isUnauthenticated, usePartnerProfile } from '../features/partner/use-partner';
import { describeError } from '../lib/errors';

function PartnerLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = usePartnerProfile();
  const unauthenticated = profile.isError && isUnauthenticated(profile.error);

  useEffect(() => {
    if (!unauthenticated) {
      return;
    }
    void navigate({
      to: '/masuk',
      search: { next: location.pathname },
      replace: true,
    });
  }, [unauthenticated, location.pathname, navigate]);

  if (profile.isPending) {
    return (
      <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>
    );
  }

  if (unauthenticated) {
    return (
      <StatePanel title="Sesi berakhir">
        Sesi mitra sudah tidak berlaku. Kamu dialihkan ke halaman masuk.
      </StatePanel>
    );
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
    return (
      <StatePanel title="Memeriksa sesi">Memastikan cookie sesi mitra masih berlaku.</StatePanel>
    );
  }

  return (
    <>
      <PartnerBar profile={profile.data} />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/partner')({
  component: PartnerLayout,
});