import { Link } from '@tanstack/react-router';
import type { BoardRow } from '../../lib/board';
import { evidenceOf } from '../../lib/evidence';
import { formatMinutesShort, formatNumber } from '../../lib/time';

export interface StopBoardProps {
  rows: readonly BoardRow[];
}

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

function StopRow({ row }: { row: BoardRow }) {
  return (
    <tr role="row">
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
        <PromiseCell row={row} />
      </td>
      <td role="cell" className="board-num">
        <span className="cell-label" aria-hidden="true">
          Episode
        </span>
        {row.episodes === 0 ? '—' : formatNumber(row.episodes, 0)}
      </td>
      <td role="cell" className="board-level">
        <span className="level" data-level={row.level}>
          {evidenceOf(row.level).label}
        </span>
      </td>
    </tr>
  );
}

export function StopBoard({ rows }: StopBoardProps) {
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
          <StopRow key={row.stopId} row={row} />
        ))}
      </tbody>
    </table>
  );
}