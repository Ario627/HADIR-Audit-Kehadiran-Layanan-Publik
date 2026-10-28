import type { ReportCategory, ReportStatus } from '@hadir/contracts';
import { categoryLabel, statusLabel } from '../../lib/report';
import { INBOX_STATUSES, type InboxFilter } from '../../lib/partner';

export interface InboxFiltersProps {
  filter: InboxFilter;
  onChange: (filter: InboxFilter) => void;
}

const CATEGORY_OPTIONS: readonly ReportCategory[] = [
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
];

function isFiltered(filter: InboxFilter): boolean {
  return filter.status !== 'all' || filter.category !== 'all';
}

export function InboxFilters({ filter, onChange }: InboxFiltersProps) {
  return (
    <div className="inbox-filters" role="group" aria-label="Saringan laporan">
      <div className="field">
        <label htmlFor="inbox-status">Status</label>
        <select
          id="inbox-status"
          value={filter.status}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filter,
              status: value === 'all' ? 'all' : (value as ReportStatus),
            });
          }}
        >
          <option value="all">Semua status</option>
          {INBOX_STATUSES.map((status) => (
            <option key={status} value={status}>
              {statusLabel(status)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="inbox-category">Kategori</label>
        <select
          id="inbox-category"
          value={filter.category}
          onChange={(event) => {
            const value = event.target.value;
            onChange({
              ...filter,
              category: value === 'all' ? 'all' : (value as ReportCategory),
            });
          }}
        >
          <option value="all">Semua kategori</option>
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </div>

      {isFiltered(filter) ? (
        <div className="actions">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              onChange({ status: 'all', category: 'all' });
            }}
          >
            Atur ulang saringan
          </button>
        </div>
      ) : null}
    </div>
  );
}