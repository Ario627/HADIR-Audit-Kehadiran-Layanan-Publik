import type { PartnerProfile } from '@hadir/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { roleLabel } from '../../lib/partner';
import { usePartnerLogout } from './use-partner';

export interface PartnerBarProps {
  profile: PartnerProfile;
}

export function PartnerBar({ profile }: PartnerBarProps) {
  const navigate = useNavigate();
  const logout = usePartnerLogout();

  const signOut = (): void => {
    logout.mutate(undefined, {
      onSettled: () => {
        void navigate({ to: '/masuk', replace: true });
      },
    });
  };

  return (
    <section className="partnerbar" aria-label="Sesi mitra">
      <div className="partnerbar-id">
        <p className="label">Mitra</p>
        <p className="partnerbar-name">{profile.institutionName}</p>
        <p className="partnerbar-meta">
          {profile.displayName} · {roleLabel(profile.role)}
        </p>
      </div>
      <nav className="partnerbar-nav" aria-label="Navigasi mitra">
        <Link to="/partner" activeProps={{ className: 'is-active' }} activeOptions={{ exact: true }}>
          Ringkasan
        </Link>
        <Link
          to="/partner/laporan"
          activeProps={{ className: 'is-active' }}
          activeOptions={{ exact: false }}
        >
          Laporan
        </Link>
        <Link to="/partner/pengaturan" activeProps={{ className: 'is-active' }}>
          Pengaturan
        </Link>
        <Link to="/" activeProps={{ className: 'is-active' }}>
          Situs publik
        </Link>
      </nav>
      <div className="partnerbar-actions">
        <button type="button" className="link-button" onClick={signOut} disabled={logout.isPending}>
          {logout.isPending ? 'Keluar…' : 'Keluar'}
        </button>
      </div>
    </section>
  );
}