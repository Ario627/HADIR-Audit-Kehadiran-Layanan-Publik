import { Link } from '@tanstack/react-router';

export function ScanBar() {
  return (
    <div className="scanbar">
      <Link to="/scan" className="scanbar-main">
        <span>
          <span className="scanbar-title">Pindai stiker halte</span>
          <span className="scanbar-sub">Satu ketukan · tanpa akun</span>
        </span>
        <span className="scanbar-glyph" aria-hidden="true">
          QR
        </span>
      </Link>
      <div className="scanbar-alt">
        <Link to="/sekitar">Tidak ada stiker? Pakai lokasi</Link>
        <Link to="/lapor">Lapor tanpa menunggu</Link>
      </div>
    </div>
  );
}
