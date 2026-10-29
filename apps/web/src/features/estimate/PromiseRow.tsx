import type { Estimate } from '@hadir/contracts';
import { safeExternalUrl } from '../../lib/safe-url';
import { formatMinutesShort } from '../../lib/time';

export interface PromiseRowProps {
  promise: Estimate['promise'];
  routeCount: number;
}

export function PromiseRow({ promise, routeCount }: PromiseRowProps) {
  if (promise === null) {
    const multipleRoutes = routeCount > 1;
    return (
      <p className="promise-row">
        <span className="promise-label">Janji headway</span>
        <span className="promise-value">
          {multipleRoutes ? 'Pilih satu koridor' : 'Belum tercatat'}
        </span>
        <span className="promise-note">
          {multipleRoutes
            ? 'Halte ini dilayani lebih dari satu koridor dengan janji berbeda, jadi janji tidak bisa ditetapkan sebelum koridor dipilih.'
            : 'Tanpa janji resmi, level bukti maksimum adalah indikasi.'}
        </span>
      </p>
    );
  }

  const source = safeExternalUrl(promise.sourceUrl);

  return (
    <p className="promise-row">
      <span className="promise-label">Janji headway</span>
      <span className="promise-value">{formatMinutesShort(promise.headwayMin)}</span>
      <span className="promise-note">
        {source === null ? (
          promise.source
        ) : (
          <a href={source} target="_blank" rel="noopener noreferrer">
            {promise.source}
            <span className="visually-hidden"> (buka sumber di tab baru)</span>
          </a>
        )}
      </span>
    </p>
  );
}