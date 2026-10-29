import type { ReportCategory } from '@hadir/contracts';
import { categoryHint, categoryLabel, REPORT_CATEGORIES } from '../../lib/report';

export interface CategoryPickerProps {
  value: ReportCategory | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (category: ReportCategory) => void;
}

export function CategoryPicker({ value, disabled, invalid, onChange }: CategoryPickerProps) {
  return (
    <fieldset
      className="categories"
      id="kategori-laporan"
      tabIndex={-1}
      aria-invalid={invalid}
      aria-describedby="kategori-laporan-hint"
    >
      <legend className="label">Apa yang mau dilaporkan</legend>
      <p className="field-hint" id="kategori-laporan-hint">
        Pilih satu kategori. Kalau ragu, pilih Lainnya; isi ceritamu tetap dibaca petugas.
      </p>
      {REPORT_CATEGORIES.map((category) => (
        <label key={category} className="category" data-selected={value === category}>
          <input
            type="radio"
            name="kategori"
            value={category}
            checked={value === category}
            disabled={disabled}
            onChange={() => {
              onChange(category);
            }}
          />
          <span className="category-body">
            <span className="category-name">{categoryLabel(category)}</span>
            <span className="category-hint">{categoryHint(category)}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}