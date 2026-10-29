import type { ReportListItem } from '@hadir/contracts';
import { Link } from '@tanstack/react-router';
import { categoryLabel, statusLabel } from '../../lib/report';
import { isOpenStatus } from '../../lib/partner';
import { formatDateTime } from '../../lib/time';

export interface InboxListProps {
  items: readonly ReportListItem[];
}

function InboxRow({ item }: { item: ReportListItem }) {
  return (
    <tr role="row">
      <th scope="row" role="rowheader" className="board-code">
        <Link to="/partner/laporan/$publicId" params={{ publicId: item.publicId }}>
          {item.publicId}
        </Link>
      </th>
      <td role="cell" className="board-name">
        {categoryLabel(item.category)}
        <span className="board-meta">
          {item.stopCode} · {item.stopName}
        </span>
      </td>
      <td role="cell" className="board-promise">
        <span className="cell-label" aria-hidden="true">
          Status
        </span>
        <span data-open={isOpenStatus(item.status) ? 'true' : 'false'}>{statusLabel(item.status)}</span>
      </td>
      <td role="cell" className="board-num">
        <span className="cell-label" aria-hidden="true">
          Dukungan
        </span>
        {item.corroborationCount === 0 ? '—' : item.corroborationCount}
      </td>
      <td role="cell" className="board-level">
        <span className="cell-label" aria-hidden="true">
          Masuk
        </span>
        {formatDateTime(item.createdAt)}
      </td>
    </tr>
  );
}

export function InboxList({ items }: InboxListProps) {
  return (
    <table className="board" role="table">
      <caption className="visually-hidden">
        Laporan yang masuk ke instansimu, beserta status dan jumlah dukungan warga
      </caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">
            ID laporan
          </th>
          <th scope="col" role="columnheader">
            Kategori
          </th>
          <th scope="col" role="columnheader">
            Status
          </th>
          <th scope="col" role="columnheader">
            Dukungan
          </th>
          <th scope="col" role="columnheader">
            Masuk
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {items.map((item) => (
          <InboxRow key={item.publicId} item={item} />
        ))}
      </tbody>
    </table>
  );
}