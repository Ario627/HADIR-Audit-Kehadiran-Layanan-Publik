import { Link, Outlet, createRootRouteWithContext, useRouter } from '@tanstack/react-router';
import type { ErrorComponentProps } from '@tanstack/react-router';
import { Masthead } from '../components/Masthead';
import { PlatformLine } from '../components/PlatformLine';
import { StatePanel } from '../components/StatePanel';
import { isApiError } from '../lib/api';
import type { RouterContext } from '../lib/router-context';
import { useOnline } from '../lib/use-online';

function RootLayout() {
  const online = useOnline();
  return (
    <>
      <a className="skip-link" href="#main">
        Lewati ke konten utama
      </a>
      <PlatformLine />
      {online ? null : (
        <p className="offline-bar" role="status">
          Kamu offline. Angka yang tampil berasal dari data terakhir yang berhasil dimuat.
        </p>
      )}
      <Masthead />
      <main id="main" className="shell main">
        <Outlet />
      </main>
      <footer className="shell footer">
        <p>HADIR · bukti tunggu bus bersubsidi</p>
        <p>
          <Link to="/metodologi">Cara angka ini dihitung</Link>
        </p>
      </footer>
    </>
  );
}

function RootErrorPage({ error }: ErrorComponentProps) {
  const router = useRouter();
  const known = isApiError(error);
  return (
    <section>
      <div className="page-head">
        <p className="label">Gangguan</p>
        <h1 className="page-title">Halaman tidak bisa dimuat</h1>
      </div>
      <StatePanel tone="error" title={known ? error.message : 'Terjadi kesalahan tak terduga'}>
        {known && error.requestId !== null
          ? `Sebutkan kode permintaan ${error.requestId} saat melapor.`
          : 'Coba muat ulang. Jika berulang, laporkan tanpa menyertakan data pribadi.'}
      </StatePanel>
      <div className="actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            void router.invalidate();
          }}
        >
          Coba lagi
        </button>
        <Link to="/" className="btn btn--ghost">
          Ke papan
        </Link>
      </div>
    </section>
  );
}

function NotFoundPage() {
  return (
    <section>
      <div className="page-head">
        <p className="label">404</p>
        <h1 className="page-title">Halaman tidak ditemukan</h1>
        <p className="page-lede">Alamat ini tidak ada. Papan bukti memuat daftar halte yang terdaftar.</p>
      </div>
      <div className="actions">
        <Link to="/" className="btn">
          Ke papan
        </Link>
      </div>
    </section>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  errorComponent: RootErrorPage,
  notFoundComponent: NotFoundPage,
});