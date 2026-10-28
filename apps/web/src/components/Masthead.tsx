import { Link } from '@tanstack/react-router';

export function Masthead() {
  return (
    <header className="shell masthead">
      <Link to="/" className="wordmark">
        <strong>HADIR</strong>
        <span>Audit kehadiran layanan</span>
      </Link>
      <nav className="nav" aria-label="Navigasi utama">
        <Link to="/" activeProps={{ className: 'is-active' }} activeOptions={{ exact: true }}>
          Papan
        </Link>
        <Link to="/peta" activeProps={{ className: 'is-active' }}>
          Peta
        </Link>
        <Link to="/sekitar" activeProps={{ className: 'is-active' }}>
          Sekitar
        </Link>
        <Link to="/lapor" activeProps={{ className: 'is-active' }}>
          Lapor
        </Link>
        <Link to="/metodologi" activeProps={{ className: 'is-active' }}>
          Metodologi
        </Link>
      </nav>
    </header>
  );
}