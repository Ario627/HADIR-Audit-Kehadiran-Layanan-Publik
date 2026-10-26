import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo } from 'react';
import { StatePanel } from '../components/StatePanel';
import { BoardLedger } from '../features/board/BoardLedger';
import { StopBoard } from '../features/board/StopBoard';
import { StopFilter } from '../features/board/StopFilter';
import {
  buildRows,
  readFilter,
  readPeriod,
  summarizeRows,
  toSearchParams,
  viewRows,
  type BoardSearchParams,
} from '../lib/board';
import { prefetchAll } from '../lib/prefetch';
import { coverageSummaryQuery, stopsQuery } from '../lib/queries';

const STOP_LIMIT = 100;

function BoardPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const filter = readFilter(search);
  const stops = useQuery(stopsQuery({ q: '', limit: STOP_LIMIT }));
  const coverage = useQuery(coverageSummaryQuery(filter.period));

  const board = useMemo(() => {
    if (stops.data === undefined || coverage.data === undefined) {
      return null;
    }
    const rows = buildRows(stops.data.items, coverage.data.stops);
    return {
      totals: summarizeRows(rows),
      visible: viewRows(rows, filter),
      hasMore: stops.data.hasMore,
    };
  }, [stops.data, coverage.data, filter.q, filter.sort, filter.level]);

  const failed = stops.isError || coverage.isError;

  return (
    <>
      <div className="page-head">
        <p className="label">Papan</p>
        <h1 className="page-title">Berapa lama orang benar-benar menunggu</h1>
        <p className="page-lede">
          Angka di papan ini berasal dari episode tunggu yang dicatat warga di halte terdaftar. Halte tanpa
          data dibiarkan kosong, bukan diisi nol.
        </p>
      </div>

      {failed ? (
        <StatePanel tone="error" title="Papan bukti tidak bisa dimuat">
          Periksa koneksi lalu muat ulang halaman. Data yang sudah pernah dimuat tetap tersedia setelah
          koneksi kembali.
        </StatePanel>
      ) : null}

      {board === null ? (
        <StatePanel title="Memuat papan bukti">Mengambil daftar halte dan cakupan data.</StatePanel>
      ) : (
        <>
          <BoardLedger totals={board.totals} period={filter.period} />
          <StopFilter
            value={filter}
            onApply={(next) => {
              void navigate({ search: toSearchParams(next) });
            }}
          />
          {board.visible.length === 0 ? (
            <StatePanel title="Tidak ada halte yang cocok">
              Ubah kata kunci atau level bukti. Ringkasan di atas tetap menghitung seluruh halte terdaftar.
            </StatePanel>
          ) : (
            <StopBoard rows={board.visible} />
          )}
          {board.hasMore ? (
            <p className="note">
              Papan memuat {STOP_LIMIT} halte pertama. Saringan di atas hanya berlaku untuk halte
              yang sudah dimuat, bukan seluruh basis data.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/')({
  validateSearch: (raw: Record<string, unknown>): BoardSearchParams =>
    toSearchParams(readFilter(raw)),
  loaderDeps: ({ search }) => ({ period: readPeriod(search.period) }),
  loader: async ({ context, deps }) => {
    await prefetchAll(
      context.queryClient.ensureQueryData(stopsQuery({ q: '', limit: STOP_LIMIT })),
      context.queryClient.ensureQueryData(coverageSummaryQuery(deps.period)),
    );
  },
  component: BoardPage,
});