import { Link } from '@tanstack/react-router';
import type { BoardRow } from '../../lib/board';
import { evidenceOf } from '../../lib/evidence';
import { formatMinutesShort, formatNumber } from '../../lib/time';

export interface StopBoardProps {
  rows: readonly BoardRow[];
  highlightedId?: string | null;
  onHighlight?: (stopId: string | null) => void;
}

const BAR_UNITS = 100;

function PromiseCell({ row }: { row: BoardRow }) {
  if (row.promiseMinutes === null) {
    return <>—</>;
  }
  const label = formatMinutesShort(row.promiseMinutes);
  if (row.promiseSource === null) {
    return <>{label}</>;
  }
  return (
    <>
      <a href={row.promiseSource} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
      <span className="visually-hidden"> (sumber janji, buka di tab baru)</span>
    </>
  );
}

function EpisodeBar({ value, max }: { value: number; max: number }) {
  const width = max <= 0 ? 0 : Math.max(1, Math.round((value / max) * 100));
  return (
    <svg
      className="board-bar"
      viewBox={`0 0 ${String(BAR_UNITS)} 1`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="0" y="0" width={width} height="1" />
    </svg>
  );
}

function StopRow({
  row,
  maxEpisodes,
  highlighted,
  onHighlight,
}: {
  row: BoardRow;
  maxEpisodes: number;
  highlighted: boolean;
  onHighlight: ((stopId: string | null) => void) | undefined;
}) {
  const link = onHighlight;
  return (
    <tr
      role="row"
      className="board-row"
      data-highlighted={highlighted ? 'true' : 'false'}
      onMouseEnter={link === undefined ? undefined : () => { link(row.stopId); }}
      onMouseLeave={link === undefined ? undefined : () => { link(null); }}
      onFocusCapture={link === undefined ? undefined : () => { link(row.stopId); }}
      onBlurCapture={link === undefined ? undefined : () => { link(null); }}
    >
      <th scope="row" role="rowheader" className="board-code">
        {row.code}
      </th>
      <td role="cell" className="board-name">
        <Link to="/s/$stopCode" params={{ stopCode: row.code }}>
          {row.name}
        </Link>
        <span className="board-meta">
          {row.corridors.length === 0 ? 'Koridor belum terdaftar' : row.corridors.join(' · ')}
          {row.isDemo ? ' · data simulasi' : ''}
        </span>
      </td>
      <td role="cell" className="board-promise">
        <span className="cell-label" aria-hidden="true">
          Janji
        </span>
        <span className="board-promise-value">
          <PromiseCell row={row} />
        </span>
      </td>
      <td role="cell" className="board-num">
        <span className="cell-label" aria-hidden="true">
          Episode
        </span>
        <span className="board-num-value">
          {row.episodes === 0 ? '—' : formatNumber(row.episodes, 0)}
        </span>
        {row.episodes === 0 ? null : <EpisodeBar value={row.episodes} max={maxEpisodes} />}
      </td>
      <td role="cell" className="board-level">
        <span className="level" data-level={row.level}>
          {evidenceOf(row.level).label}
        </span>
      </td>
    </tr>
  );
}

export function StopBoard({ rows, highlightedId = null, onHighlight }: StopBoardProps) {
  const maxEpisodes = rows.reduce((best, row) => Math.max(best, row.episodes), 0);
  return (
    <table className="board" role="table">
      <caption className="visually-hidden">
        Janji headway, jumlah episode, dan level bukti per halte
      </caption>
      <thead role="rowgroup">
        <tr role="row">
          <th scope="col" role="columnheader">
            Kode
          </th>
          <th scope="col" role="columnheader">
            Halte
          </th>
          <th scope="col" role="columnheader">
            Janji
          </th>
          <th scope="col" role="columnheader">
            Episode
          </th>
          <th scope="col" role="columnheader">
            Bukti
          </th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {rows.map((row) => (
          <StopRow
            key={row.stopId}
            row={row}
            maxEpisodes={maxEpisodes}
            highlighted={row.stopId === highlightedId}
            onHighlight={onHighlight}
          />
        ))}
      </tbody>
    </table>
  );
}