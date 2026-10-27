import type { ReactNode } from 'react';
import type { TicketView } from '../../lib/episode';
import { formatClockTime } from '../../lib/time';
import { ElapsedClock } from './ElapsedClock';

export interface WaitTicketProps {
  view: TicketView;
  seconds: number;
  actions: ReactNode;
  status: ReactNode;
}

export function WaitTicket({ view, seconds, actions, status }: WaitTicketProps) {
  return (
    <article className="ticket">
      <div className="ticket-head">
        <p>
          <span className="board-code">{view.code}</span>
          {view.routeCode === null ? null : <span> · {view.routeCode}</span>}
        </p>
        <p>{view.modeLabel}</p>
      </div>
      <ElapsedClock seconds={seconds} />
      {view.presenceNote === null ? null : <p className="ticket-note">{view.presenceNote}</p>}
      {actions}
      <div className="ticket-foot">
        <p>Mulai {formatClockTime(view.startedAt)}</p>
        {status}
      </div>
    </article>
  );
}