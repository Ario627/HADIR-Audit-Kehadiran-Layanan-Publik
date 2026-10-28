import { useInfiniteQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { StatePanel } from '../components/StatePanel';
import { InboxFilters } from '../features/partner/InboxFilters';
import { InboxList } from '../features/partner/InboxList';
import { describeError } from '../lib/errors';
import { readInboxFilter, toInboxSearch, type InboxFilter } from '../lib/partner';
import { fetchInbox } from '../lib/partner-api';
import type { PartnerInbox } from '../lib/partner-guards';

const PAGE_SIZE = 20;

function InboxPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const filter = readInboxFilter(search);

  const inbox = useInfiniteQuery({
    queryKey: ['partner', 'inbox', filter, 'page'] as const,
    queryFn: ({ pageParam }) => fetchInbox({ filter, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: PartnerInbox) => (last.hasMore ? last.nextCursor : null),
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: false,
  });

  const apply = (next: InboxFilter): void => {
    void navigate({ to: '/partner/laporan', search: toInboxSearch(next) });
  };

  const items = inbox.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="page-head">
        <p className="label">Inbox</p>
        <h1 className="page-title">Laporan untuk instansimu</h1>
        <p className="page-lede">
          Laporan diurutkan dari yang terbaru. Saringan disimpan di alamat halaman, jadi tautan ke inbox
          yang sudah tersaring bisa kamu kirim ke rekan satu instansi.
        </p>
      </div>

      <InboxFilters filter={filter} onChange={apply} />

      {inbox.isPending ? (
        <StatePanel title="Memuat laporan">Mengambil laporan yang masuk ke instansimu.</StatePanel>
      ) : inbox.isError ? (
        <>
          <StatePanel tone="error" title={describeError(inbox.error).title}>
            {describeError(inbox.error).detail}
          </StatePanel>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void inbox.refetch();
              }}
            >
              Coba lagi
            </button>
          </div>
        </>
      ) : items.length === 0 ? (
        <StatePanel title="Tidak ada laporan dengan saringan ini">
          Atur ulang saringan untuk melihat seluruh laporan yang masuk.
        </StatePanel>
      ) : (
        <>
          <InboxList items={items} />
          {inbox.hasNextPage ? (
            <div className="actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={inbox.isFetchingNextPage}
                onClick={() => {
                  void inbox.fetchNextPage();
                }}
              >
                {inbox.isFetchingNextPage ? 'Memuat' : 'Muat lebih banyak'}
              </button>
            </div>
          ) : (
            <p className="note">Semua laporan pada saringan ini sudah tampil.</p>
          )}
        </>
      )}
    </>
  );
}

export const Route = createFileRoute('/partner/laporan/')({
  validateSearch: (raw: Record<string, unknown>) => toInboxSearch(readInboxFilter(raw)),
  component: InboxPage,
});