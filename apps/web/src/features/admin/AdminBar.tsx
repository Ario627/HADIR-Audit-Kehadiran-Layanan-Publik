import type { AdminProfile } from '@hadir/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAdminLogout } from './use-admin';

const ROLE_LABEL: Readonly<Record<AdminProfile['role'], string>> = {
  moderator: 'Moderator',
  superadmin: 'Superadmin',
};

const FLOW_LINKS = [
  { to: '/admin', label: 'Ringkasan', exact: true },
  { to: '/admin/moderasi', label: 'Moderasi' },
  { to: '/admin/banding', label: 'Banding' },
  { to: '/admin/sla', label: 'SLA' },
  { to: '/admin/komitmen', label: 'Komitmen' },
  { to: '/admin/konteks', label: 'Konteks' },
] as const;

const SYSTEM_LINKS = [
  { to: '/admin/rantai', label: 'Rantai' },
  { to: '/admin/audit', label: 'Audit' },
  { to: '/admin/rup', label: 'RUP' },
  { to: '/admin/retensi', label: 'Retensi' },
  { to: '/admin/flag', label: 'Flag' },
] as const;

export function AdminBar({ profile }: { profile: AdminProfile }) {
  const navigate = useNavigate();
  const logout = useAdminLogout();

  return (
    <section className="consolebar" aria-label="Sesi admin platform">
      <div className="consolebar-id">
        <p className="label">Platform</p>
        <p className="consolebar-name">{profile.displayName}</p>
        <p className="consolebar-meta">
          {ROLE_LABEL[profile.role]} · sesi sampai{' '}
          {profile.expiresAt.slice(11, 16).replace(':', '.')} UTC
        </p>
      </div>

      <nav className="consolebar-nav" aria-label="Alur penanganan">
        <span className="consolebar-group">Alur</span>
        {FLOW_LINKS.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            activeProps={{ className: 'is-active' }}
            activeOptions={{ exact: 'exact' in link }}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <nav className="consolebar-nav" aria-label="Sistem dan kepatuhan">
        <span className="consolebar-group">Sistem</span>
        {SYSTEM_LINKS.map((link) => (
          <Link key={link.to} to={link.to} activeProps={{ className: 'is-active' }}>
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="consolebar-actions">
        <Link to="/" className="consolebar-exit">
          Situs publik
        </Link>
        <button
          type="button"
          className="link-button"
          disabled={logout.isPending}
          onClick={() => {
            logout.mutate(undefined, {
              onSettled: () => {
                void navigate({ to: '/admin/masuk', replace: true });
              },
            });
          }}
        >
          {logout.isPending ? 'Keluar…' : 'Keluar'}
        </button>
      </div>
    </section>
  );
}
