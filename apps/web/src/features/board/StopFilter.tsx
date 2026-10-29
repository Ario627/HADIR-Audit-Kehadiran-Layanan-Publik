import { useId } from 'react';
import {
  asBoardLevelFilter,
  asBoardSort,
  readPeriod,
  readQueryParam,
  type BoardQuery,
} from '../../lib/board';
import { EVIDENCE_LEVELS, evidenceOf } from '../../lib/evidence';

export interface StopFilterProps {
  value: BoardQuery;
  onApply: (next: BoardQuery) => void;
}

const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'measured', label: 'Data terbanyak' },
  { value: 'code', label: 'Kode halte' },
  { value: 'name', label: 'Nama halte' },
];

const PERIOD_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '7d', label: '7 hari terakhir' },
  { value: '30d', label: '30 hari terakhir' },
];

export function StopFilter({ value, onApply }: StopFilterProps) {
  const queryId = useId();
  const levelId = useId();
  const periodId = useId();
  const sortId = useId();
  const hintId = useId();

  return (
    <form
      className="filter"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onApply({
          q: readQueryParam(data.get('q')),
          sort: asBoardSort(data.get('sort')),
          level: asBoardLevelFilter(data.get('level')),
          period: readPeriod(data.get('period')),
        });
      }}
    >
      <div className="field">
        <label htmlFor={queryId}>Saring halte</label>
        <input
          id={queryId}
          name="q"
          type="search"
          defaultValue={value.q}
          maxLength={100}
          autoComplete="off"
          aria-describedby={hintId}
          placeholder="Nama, kode, atau koridor"
        />
        <span className="field-hint" id={hintId}>
          Disaring di perangkat ini, bukan di server.
        </span>
      </div>
      <div className="field">
        <label htmlFor={levelId}>Level bukti</label>
        <select id={levelId} name="level" defaultValue={value.level}>
          <option value="all">Semua level</option>
          {EVIDENCE_LEVELS.map((level) => (
            <option key={level} value={level}>
              {evidenceOf(level).label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={periodId}>Jendela data</label>
        <select id={periodId} name="period" defaultValue={value.period}>
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={sortId}>Urutkan</label>
        <select id={sortId} name="sort" defaultValue={value.sort}>
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" className="btn">
        Terapkan
      </button>
    </form>
  );
}