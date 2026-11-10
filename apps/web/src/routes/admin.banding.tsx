import { createFileRoute } from '@tanstack/react-router';
import { AppealQueue } from '../features/admin/AppealQueue';
import { useAdminProfile } from '../features/admin/use-admin';

function AdminAppealPage() {
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';

  return (
    <>
      <div className="page-head">
        <p className="label">Banding</p>
        <h1 className="page-title">Keberatan atas laporan dan putusan</h1>
        <p className="page-lede">
          Setiap banding punya tenggat keputusan. Yang lewat tenggat ditandai merah, bukan
          dibiarkan menghilang dari antrean.
        </p>
      </div>

      <AppealQueue canDecide={superadmin} />
    </>
  );
}

export const Route = createFileRoute('/admin/banding')({
  component: AdminAppealPage,
});
