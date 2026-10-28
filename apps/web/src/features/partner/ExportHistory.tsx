import type { PartnerExportDetail } from '@hadir/contracts';
import { formatDateTime } from '../../lib/time';
import {
  exportFormatLabel,
  exportStatusLabel,
  formatByteSize,
  formatRowCount,
  isDownloadable,
} from '../../lib/export';

export interface ExportHistoryProps {
  items: readonly PartnerExportDetail[];
  pendingId: string | null;
  onDownload: (detail: PartnerExportDetail) => void;
}

const STATUS_NOTE: Partial<Record<PartnerExportDetail['status'], string>> = {
  expired:
    'Berkas ini sudah dihapus karena melewati masa simpan. Buat ekspor baru untuk data yang sama.',
  failed: 'Penyiapan gagal di server. Coba buat ekspor baru dengan rentang lebih sempit.',
  queued: 'Berkas masih menunggu antrean. Muat ulang daftar beberapa saat lagi.',
  running: 'Berkas masih disiapkan. Muat ulang daftar beberapa saat lagi.',
};

function ExportRow({
  item,
  pending,
  onDownload,
}: {
  item: PartnerExportDetail;
  pending: boolean;
  onDownload: (detail: PartnerExportDetail) => void;
}) {
  const ready = isDownloadable(item);
  return (
    <li className="export-item">
      <div className="export-item-head">
        <span className="export-item-format">{exportFormatLabel(item.format)}</span>
        <span className="export-item-status" data-status={item.status}>
          {exportStatusLabel(item.status)}
        </span>
      </div>
      <p className="export-item-meta">
        {formatDateTime(item.createdAt)} · {formatRowCount(item.rowCount)} ·{' '}
        {formatByteSize(item.byteSize)}
      </p>
      {ready ? (
        <>
          <div className="actions">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={pending}
              aria-busy={pending}
              onClick={() => {
                onDownload(item);
              }}
            >
              {pending ? 'Menyiapkan unduhan' : 'Unduh'}
            </button>
          </div>
          {item.expiresAt === null ? null : (
            <p className="export-item-meta">Berkas tersedia sampai {formatDateTime(item.expiresAt)}.</p>
          )}
        </>
      ) : (
        <p className="export-item-note">
          {STATUS_NOTE[item.status] ?? 'Status berkas ini belum bisa diunduh.'}
        </p>
      )}
    </li>
  );
}

export function ExportHistory({ items, pendingId, onDownload }: ExportHistoryProps) {
  if (items.length === 0) {
    return <p className="note">Belum ada ekspor untuk instansimu.</p>;
  }
  return (
    <ul className="export-list">
      {items.map((item) => (
        <ExportRow
          key={item.exportId}
          item={item}
          pending={pendingId === item.exportId}
          onDownload={onDownload}
        />
      ))}
    </ul>
  );
}