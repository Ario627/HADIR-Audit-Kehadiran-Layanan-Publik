import { Link } from '@tanstack/react-router';
import { ThemeToggle } from '../features/theme/ThemeToggle';

const ACTIVE = { className: 'is-active', 'aria-current': 'page' } as const;

export function Masthead() {
  return (
    <header className="shell masthead">
      <Link to="/" className="wordmark">
        <strong>HADIR</strong>
        <span>Audit kehadiran layanan</span>
      </Link>
      <div className="masthead-tools">
        <nav className="nav" aria-label="Navigasi utama">
          <Link to="/" activeProps={ACTIVE} activeOptions={{ exact: true }}>
            Papan
          </Link>
          <Link to="/peta" activeProps={ACTIVE}>
            Peta
          </Link>
          <Link to="/sekitar" activeProps={ACTIVE}>
            Sekitar
          </Link>
          <Link to="/lapor" activeProps={ACTIVE}>
            Lapor
          </Link>
          <Link to="/metodologi" activeProps={ACTIVE}>
            Metodologi
          </Link>
          <a href="/#kabar">Kabar</a>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}