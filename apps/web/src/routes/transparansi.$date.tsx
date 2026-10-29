import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { AnchorCard } from '../features/transparency/AnchorCard';
import { anchorDateLabel, nextDayUtc, readAnchorDate, yesterdayUtc } from '../lib/anchor';
import { isApiError } from '../lib/api';
import { describeError } from '../lib/errors';
import { transparencyAnchorQuery } from '../lib/queries';

function TransparencyDatePage() {
  const params = Route.useParams();
  const date = readAnchorDate(params.date);
  const anchor = useQuery({
    ...transparencyAnchorQuery(date ?? ''),
    enabled: date !== null,
  });

  if (date === null) {
    return (
      <>
        <div className="page-head">
          <p className="label">Tanggal tidak valid</p>
          <h1 className="page-title">Alamat anchor ini rusak</h1>
          <p className="page-lede">
            Tanggal anchor harus berbentuk tahun-bulan-hari, misalnya 2026-10-31.
          </p>
        </div>
        <div className="actions">
          <Link to="/transparansi" className="btn">
            Pilih tanggal lain
          </Link>
        </div>
      </>
    );
  }

  const notFound = anchor.isError && isApiError(anchor.error) && anchor.error.code === 'NOT_FOUND';
  const otherError = anchor.isError && !notFound;
  const tomorrow = nextDayUtc(date);
  const latest = yesterdayUtc(new Date());
  const next = tomorrow !== null && tomorrow <= latest ? tomorrow : null;

  return (
    <>
      <div className="page-head">
        <p className="label">Transparansi</p>
        <h1 className="page-title">Anchor {anchorDateLabel(date)}</h1>
        <p className="page-lede">
          Halaman ini adalah tujuan tautan verifikasi anchor harian. Isinya hanya ringkasan rantai,
          bukan isi laporan warga.
        </p>
      </div>

      {anchor.isPending ? (
        <StatePanel title="Memuat anchor">Mengambil akar Merkle untuk {date}.</StatePanel>
      ) : notFound ? (
        <StatePanel title="Anchor belum diterbitkan">
          Tanggal {date} belum punya anchor. Buka daftar transparansi untuk mencari tanggal yang sudah
          diterbitkan.
        </StatePanel>
      ) : otherError ? (
        <>
          <StatePanel tone="error" title={describeError(anchor.error).title}>
            {describeError(anchor.error).detail}
          </StatePanel>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void anchor.refetch();
              }}
            >
              Coba lagi
            </button>
          </div>
        </>
      ) : anchor.data === undefined ? (
        <StatePanel tone="error" title="Anchor tidak bisa ditampilkan">
          Data anchor tidak lolos pemeriksaan bentuk, jadi tidak ditampilkan.
        </StatePanel>
      ) : (
        <AnchorCard anchor={anchor.data} />
      )}

      <nav className="anchor-nav" aria-label="Navigasi tanggal anchor">
        <Link to="/transparansi" className="btn btn--ghost">
          Daftar transparansi
        </Link>
        {next === null ? null : (
          <Link to="/transparansi/$date" params={{ date: next }} className="btn btn--ghost">
            Hari berikutnya
          </Link>
        )}
      </nav>
      <p className="note">
        Tanggal paling akhir yang bisa dipilih adalah hari yang sudah berakhir, yaitu {latest}.
      </p>
    </>
  );
}

export const Route = createFileRoute('/transparansi/$date')({
  component: TransparencyDatePage,
});