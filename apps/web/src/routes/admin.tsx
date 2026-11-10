import type { AdminProfile } from '@hadir/contracts';
import { createFileRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { StatePanel } from '../components/StatePanel';
import { AdminBar } from '../features/admin/AdminBar';
import { isAdminUnauthenticated, useAdminProfile } from '../features/admin/use-admin';
import { describeError } from '../lib/errors';

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useAdminProfile();
  const isLogin = location.pathname === '/admin/masuk';

  useEffect(() => {
    if (isLogin) {
      return;
    }
    if (!profile.isError || !isAdminUnauthenticated(profile.error)) {
      return;
    }
    void navigate({ to: '/admin/masuk', replace: true });
  }, [isLogin, navigate, profile.error, profile.isError]);

  if (isLogin) {
    return <Outlet />;
  }

  if (profile.isPending) {
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi admin platform masih berlaku.</StatePanel>;
  }

  if (profile.isError) {
    if (isAdminUnauthenticated(profile.error)) {
      return (
        <StatePanel title="Sesi berakhir">
          Sesi admin sudah tidak berlaku. Kamu dialihkan ke halaman masuk.
        </StatePanel>
      );
    }
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
    return <StatePanel title="Memeriksa sesi">Memastikan cookie sesi admin platform masih berlaku.</StatePanel>;
  }

  return (
    <>
      <AdminBar profile={profile.data as AdminProfile} />
      <Outlet />
    </>
  );
}

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
});
