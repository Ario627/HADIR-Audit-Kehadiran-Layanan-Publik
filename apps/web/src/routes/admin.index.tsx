import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
  appealStatusLabel,
  hoursText,
  moderationLabel,
  moderationTone,
  priorityLabel,
  slaPhaseLabel,
} from '../features/admin/console-ui';
import {
  fetchAppealQueue,
  fetchModerationQueue,
  fetchSlaBreaches,
} from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { categoryLabel } from '../lib/report';
import { formatDateTime } from '../lib/time';

const SHORTCUTS = [
  { to: '/admin/moderasi', label: 'Moderasi laporan', detail: 'Putuskan laporan yang menunggu.' },
  { to: '/admin/banding', label: 'Banding warga', detail: 'Putuskan banding yang masuk.' },
  { to: '/admin/sla', label: 'SLA & kota', detail: 'Tenggat per kota dan pelanggaran.' },
  { to: '/admin/komitmen', label: 'Janji layanan', detail: 'Catat, verifikasi, cabut janji.' },
  { to: '/admin/konteks', label: 'Konteks operasional', detail: 'Libur, pengumuman, insiden.' },
  { to: '/admin/rantai', label: 'Rantai bukti', detail: 'Verifikasi hash dan segel anchor.' },
] as const;

function AdminHomePage() {
  const pending = useQuery({
    queryKey: ['admin', 'queue', 'pending'],
    queryFn: () => fetchModerationQueue({ moderation: 'pending', limit: 5 }),
    staleTime: 20_000,
    retry: false,
  });
  const breaches = useQuery({
    queryKey: ['admin', 'sla-breaches', 1],
    queryFn: () => fetchSlaBreaches({ minEscalation: 1, limit: 5 }),
    staleTime: 30_000,
    retry: false,
  });
  const appeals = useQuery({
    queryKey: ['admin', 'appeals', 'submitted'],
    queryFn: () => fetchAppealQueue({ status: 'submitted', limit: 5 }),
    staleTime: 20_000,
    retry: false,
  });

  return (
    <>
      <div className="page-head">
        <p className="label">Konsol platform</p>
        <h1 className="page-title">Antrean yang menunggu keputusan</h1>
        <p className="page-lede">
          Semua aksi di konsol ini tercatat di log audit dengan id permintaan. Tidak ada tombol yang
          mengubah data tanpa jejak.
        </p>
      </div>

      <ConsolePanel
        title="Moderasi"
        meta={
          pending.data === undefined
            ? 'memuat'
            : `${String(pending.data.count)} laporan terbaru ditampilkan`
        }
        actions={
          <Link to="/admin/moderasi" className="dossier-link">
            Buka antrean
          </Link>
        }
      >
        {pending.isPending ? (
          <ConsoleHint>Memuat antrean moderasi.</ConsoleHint>
        ) : pending.isError ? (
          <ConsoleFailure
            title={describeError(pending.error).title}
            detail={describeError(pending.error).detail}
            onRetry={() => {
              void pending.refetch();
            }}
          />
        ) : pending.data.items.length === 0 ? (
          <ConsoleEmpty>Tidak ada laporan yang menunggu moderasi.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {pending.data.items.map((row) => (
              <li key={row.publicId} className="queue-row">
                <Link
                  to="/admin/laporan/$publicId"
                  params={{ publicId: row.publicId }}
                  className="queue-main"
                >
                  <span className="queue-title">{categoryLabel(row.category)}</span>
                  <span className="queue-text">{row.text}</span>
                </Link>
                <p className="queue-meta">
                  <span className="queue-code">{row.publicId}</span>
                  <span>{row.stopCode}</span>
                  <span className={`chip chip--${moderationTone(row.moderation)}`}>
                    {moderationLabel(row.moderation)}
                  </span>
                  <span>{formatDateTime(row.createdAt)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      <ConsolePanel
        title="SLA lewat tenggat"
        meta={breaches.data === undefined ? 'memuat' : `${String(breaches.data.length)} terbaru`}
        actions={
          <Link to="/admin/sla" className="dossier-link">
            Buka SLA
          </Link>
        }
      >
        {breaches.isPending ? (
          <ConsoleHint>Memuat pelanggaran tenggat.</ConsoleHint>
        ) : breaches.isError ? (
          <ConsoleFailure
            title={describeError(breaches.error).title}
            detail={describeError(breaches.error).detail}
            onRetry={() => {
              void breaches.refetch();
            }}
          />
        ) : breaches.data.length === 0 ? (
          <ConsoleEmpty>Tidak ada tenggat yang terlewat pada tingkat eskalasi ini.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {breaches.data.map((row) => (
              <li key={`${row.publicId}-${row.phase}`} className="queue-row">
                <Link
                  to="/admin/laporan/$publicId"
                  params={{ publicId: row.publicId }}
                  className="queue-main"
                >
                  <span className="queue-title">
                    {slaPhaseLabel(row.phase)} · {row.publicId}
                  </span>
                  <span className="queue-text">
                    Lewat {hoursText(row.hoursLate)} dari tenggat {formatDateTime(row.dueAt)}.
                  </span>
                </Link>
                <p className="queue-meta">
                  <span className="queue-code">{row.publicId}</span>
                  <span>{row.institutionName ?? 'tanpa instansi'}</span>
                  <span className={`chip chip--${row.escalation >= 2 ? 'alert' : 'pending'}`}>
                    eskalasi {String(row.escalation)}
                  </span>
                  <span>{priorityLabel(row.priority)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      <ConsolePanel
        title="Banding menunggu"
        meta={appeals.data === undefined ? 'memuat' : `${String(appeals.data.length)} terbaru`}
        actions={
          <Link to="/admin/banding" className="dossier-link">
            Buka banding
          </Link>
        }
      >
        {appeals.isPending ? (
          <ConsoleHint>Memuat banding.</ConsoleHint>
        ) : appeals.isError ? (
          <ConsoleFailure
            title={describeError(appeals.error).title}
            detail={describeError(appeals.error).detail}
            onRetry={() => {
              void appeals.refetch();
            }}
          />
        ) : appeals.data.length === 0 ? (
          <ConsoleEmpty>Tidak ada banding yang menunggu keputusan.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {appeals.data.map((row) => (
              <li key={row.id} className="queue-row">
                <Link
                  to="/admin/laporan/$publicId"
                  params={{ publicId: row.publicId }}
                  className="queue-main"
                >
                  <span className="queue-title">{row.groundsLabel}</span>
                  <span className="queue-text">{row.summary}</span>
                </Link>
                <p className="queue-meta">
                  <span className="queue-code">{row.publicId}</span>
                  <span className={`chip chip--${row.decisionOverdue ? 'alert' : 'pending'}`}>
                    {row.decisionOverdue ? 'lewat tenggat' : appealStatusLabel(row.status)}
                  </span>
                  <span>tenggat {formatDateTime(row.decisionDue)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </ConsolePanel>

      <nav className="console-index" aria-label="Semua bagian konsol">
        {SHORTCUTS.map((entry) => (
          <Link key={entry.to} to={entry.to} className="console-index-item">
            <span className="console-index-label">{entry.label}</span>
            <span className="console-index-detail">{entry.detail}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}

export const Route = createFileRoute('/admin/')({
  component: AdminHomePage,
});
