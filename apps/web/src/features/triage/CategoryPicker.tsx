import type { ReportCategory } from '@hadir/contracts';
import { categoryHint, categoryLabel, REPORT_CATEGORIES } from '../../lib/report';

export interface CategoryPickerProps {
  value: ReportCategory | null;
  disabled: boolean;
  onChange: (category: ReportCategory) => void;
}

export function CategoryPicker({ value, disabled, onChange }: CategoryPickerProps) {
  return (
    <fieldset className="categories">
      <legend className="label">Apa yang mau dilaporkan</legend>
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