import type { ReportCategory, ReportStatus } from '@hadir/contracts';
import { useState } from 'react';
import {
  EXPORT_FORMATS,
  exportFormatHint,
  exportFormatLabel,
  type PartnerExportFormat,
} from '../../lib/export';
import { INBOX_STATUSES } from '../../lib/partner';
import { categoryLabel, statusLabel } from '../../lib/report';

export interface ExportScope {
  format: PartnerExportFormat;
  category: ReportCategory | 'all';
  status: ReportStatus | 'all';
}

export interface ExportFormProps {
  value: ExportScope;
  busy: boolean;
  disabled: boolean;
  onChange: (next: ExportScope) => void;
  onSubmit: () => void;
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

export function ExportForm({ value, busy, disabled, onChange, onSubmit }: ExportFormProps) {
  const [scopeOpen, setScopeOpen] = useState(
    value.category !== 'all' || value.status !== 'all',
  );

  return (
    <form
      className="exportform"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="exportform-formats" role="group" aria-label="Format berkas">
        <p className="windowpicker-legend">Format berkas</p>
        <div className="exportform-options">
          {EXPORT_FORMATS.map((entry) => (
            <button
              key={entry}
              type="button"
              className="btn btn--ghost"
              aria-pressed={value.format === entry}
              onClick={() => {
                onChange({ ...value, format: entry });
              }}
            >
              {exportFormatLabel(entry)}
            </button>
          ))}
        </div>
        <p className="field-hint">{exportFormatHint(value.format)}</p>
      </div>

      <button
        type="button"
        className="link-button"
        aria-expanded={scopeOpen}
        onClick={() => {
          setScopeOpen((current) => !current);
        }}
      >
        {scopeOpen ? 'Sembunyikan saringan' : 'Saringan tambahan (opsional)'}
      </button>

      {scopeOpen ? (
        <div className="exportform-scope">
          <div className="field">
            <label htmlFor="export-category">Kategori</label>
            <select
              id="export-category"
              value={value.category}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({
                  ...value,
                  category: raw === 'all' ? 'all' : (raw as ReportCategory),
                });
              }}
            >
              <option value="all">Semua kategori</option>
              {CATEGORY_OPTIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {categoryLabel(entry)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="export-status">Status</label>
            <select
              id="export-status"
              value={value.status}
              onChange={(event) => {
                const raw = event.target.value;
                onChange({ ...value, status: raw === 'all' ? 'all' : (raw as ReportStatus) });
              }}
            >
              <option value="all">Semua status</option>
              {INBOX_STATUSES.map((entry) => (
                <option key={entry} value={entry}>
                  {statusLabel(entry)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      <div className="actions">
        <button type="submit" className="btn" disabled={busy || disabled} aria-busy={busy}>
          {busy ? 'Menyiapkan berkas' : 'Buat ekspor'}
        </button>
      </div>

      {disabled ? (
        <p className="note">Role kamu hanya bisa membaca, jadi pembuatan ekspor tidak tersedia.</p>
      ) : null}
    </form>
  );
}