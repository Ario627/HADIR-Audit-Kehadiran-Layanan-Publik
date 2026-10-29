import type { CoveragePeriod } from '@hadir/contracts';
import type { BoardTotals } from '../../lib/board';
import { formatNumber } from '../../lib/time';

export interface BoardLedgerProps {
  totals: BoardTotals;
  period: CoveragePeriod;
}

function windowLabel(period: CoveragePeriod): string {
  return period === '7d' ? '7 hari terakhir' : '30 hari terakhir';
}

export function BoardLedger({ totals, period }: BoardLedgerProps) {
  return (
    <dl className="ledger">
      <div>
        <dt>Halte terdaftar</dt>
        <dd>{formatNumber(totals.listed, 0)}</dd>
      </div>
      <div>
        <dt>Halte dengan data</dt>
        <dd>
          {formatNumber(totals.measured, 0)}
          <span className="ledger-note">{windowLabel(period)}</span>
        </dd>
      </div>
      <div>
        <dt>Episode tercatat</dt>
        <dd>
          {formatNumber(totals.episodes, 0)}
          <span className="ledger-note">di halte terdaftar</span>
        </dd>
      </div>
      <div>
        <dt>Cukup data</dt>
        <dd>
          {formatNumber(totals.withIndication, 0)}
          <span className="ledger-note">≥15 episode, ≥3 klaster</span>
        </dd>
      </div>
    </dl>
  );
}