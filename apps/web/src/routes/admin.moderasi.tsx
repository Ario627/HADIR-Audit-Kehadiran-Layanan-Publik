import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  moderationLabel,
  moderationTone,
} from '../features/admin/console-ui';
import { fetchModerationQueue } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { categoryLabel } from '../lib/report';
import { formatDateTime } from '../lib/time';

const TABS = ['pending', 'approved', 'quarantined', 'rejected'] as const;
type Tab = (typeof TABS)[number];

const EVIDENCE_LABEL: Readonly<Record<string, string>> = {
  none: 'tanpa bukti',
  indication: 'indikasi',
  strong: 'kuat',
  field_verified: 'terverifikasi lapangan',
};

function ModerationPage() {
  const [tab, setTab] = useState<Tab>('pending');
  const queue = useQuery({
    queryKey: ['admin', 'queue', tab],
    queryFn: () => fetchModerationQueue({ moderation: tab, limit: 30 }),
    staleTime: 15_000,
    retry: false,
  });

  return (
    <>
      <div className="page-head">
        <p className="label">Moderasi</p>
        <h1 className="page-title">Antrean laporan</h1>
        <p className="page-lede">
          Moderasi menentukan laporan terlihat publik atau tidak. Penolakan wajib disertai alasan
          minimal sepuluh karakter dan alasan itu tersimpan di log audit.
        </p>
      </div>

      <div className="segmented" role="tablist" aria-label="Status moderasi">
        {TABS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={tab === entry ? 'segmented-item is-active' : 'segmented-item'}
            onClick={() => {
              setTab(entry);
            }}
          >
            {moderationLabel(entry)}
          </button>
        ))}
      </div>

      <ConsolePanel
        title={`Status ${moderationLabel(tab)}`}
        meta={queue.data === undefined ? 'memuat' : `${String(queue.data.count)} laporan`}
      >
        {queue.isPending ? (
          <ConsoleHint>Memuat antrean.</ConsoleHint>
        ) : queue.isError ? (
          <ConsoleFailure
            title={describeError(queue.error).title}
            detail={describeError(queue.error).detail}
            onRetry={() => {
              void queue.refetch();
            }}
          />
        ) : queue.data.items.length === 0 ? (
          <ConsoleEmpty>Tidak ada laporan pada status ini.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {queue.data.items.map((row) => (
              <li key={row.publicId} className="queue-row">
                <Link
                  to="/admin/laporan/$publicId"
                  params={{ publicId: row.publicId }}
                  className="queue-main"
                >
                  <span className="queue-title">
                    {categoryLabel(row.category)} · {row.stopName}
                  </span>
                  <span className="queue-text">{row.text}</span>
                </Link>
                <p className="queue-meta">
                  <span className="queue-code">{row.publicId}</span>
                  <span>{row.stopCode}</span>
                  <span className={`chip chip--${moderationTone(row.moderation)}`}>
                    {moderationLabel(row.moderation)}
                  </span>
                  <span>{EVIDENCE_LABEL[row.evidenceLevel] ?? row.evidenceLevel}</span>
                  <span>{String(row.corroborationCount)} dukungan</span>
                  <span>{formatDateTime(row.createdAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/moderasi')({
  component: ModerationPage,
});
