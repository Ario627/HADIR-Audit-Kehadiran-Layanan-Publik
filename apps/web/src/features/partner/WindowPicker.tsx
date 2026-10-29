import {
  PRESETS,
  rangeIssueText,
  type DateRange,
  type RangeIssue,
  type RangePreset,
} from '../../lib/date-range';

export interface WindowPickerProps {
  preset: RangePreset;
  range: DateRange;
  issue: RangeIssue | null;
  today: string;
  maxDays: number;
  onChange: (next: { preset: RangePreset; range: DateRange }) => void;
}

const PRESET_LABELS: Record<RangePreset, string> = {
  '7d': '7 hari',
  '30d': '30 hari',
  '90d': '90 hari',
  custom: 'Pilih sendiri',
};

export function WindowPicker({
  preset,
  range,
  issue,
  today,
  maxDays,
  onChange,
}: WindowPickerProps) {
  return (
    <fieldset className="windowpicker">
      <legend className="windowpicker-legend">Rentang tanggal</legend>

      <div className="windowpicker-presets" role="group" aria-label="Rentang siap pakai">
        {PRESETS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="btn btn--ghost"
            aria-pressed={preset === entry}
            onClick={() => {
              onChange({ preset: entry, range });
            }}
          >
            {PRESET_LABELS[entry]}
          </button>
        ))}
      </div>

      {preset === 'custom' ? (
        <div className="windowpicker-custom">
          <div className="field">
            <label htmlFor="range-from">Dari tanggal</label>
            <input
              id="range-from"
              type="date"
              max={range.to === '' ? today : range.to}
              value={range.from}
              onChange={(event) => {
                onChange({ preset: 'custom', range: { ...range, from: event.target.value } });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="range-to">Sampai tanggal</label>
            <input
              id="range-to"
              type="date"
              min={range.from === '' ? undefined : range.from}
              max={today}
              value={range.to}
              onChange={(event) => {
                onChange({ preset: 'custom', range: { ...range, to: event.target.value } });
              }}
            />
          </div>
        </div>
      ) : (
        <p className="windowpicker-summary">
          {range.from} sampai {range.to}
        </p>
      )}

      {issue === null ? null : (
        <p className="field-error" role="alert">
          {rangeIssueText(issue, maxDays)}
        </p>
      )}
    </fieldset>
  );
}