import { formatTimer } from '../../lib/time';

export interface ElapsedClockProps {
  seconds: number;
}

function liveText(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  if (minutes === 0) {
    return 'Kurang dari satu menit menunggu';
  }
  return `${minutes} menit menunggu`;
}

export function ElapsedClock({ seconds }: ElapsedClockProps) {
  return (
    <div className="ticket-clock">
      <span className="clock" aria-hidden="true">
        {formatTimer(seconds)}
      </span>
      <p className="clock-label" aria-hidden="true">
        Waktu tunggu
      </p>
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {liveText(seconds)}
      </p>
    </div>
  );
}