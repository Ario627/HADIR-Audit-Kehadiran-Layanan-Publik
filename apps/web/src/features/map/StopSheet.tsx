import { Link } from '@tanstack/react-router';
import { evidenceOf } from '../../lib/evidence';
import type { MapPoint } from '../../lib/map';
import { formatNumber } from '../../lib/time';

export interface StopSheetProps {
  point: MapPoint;
  onClose: () => void;
}

export function StopSheet({ point, onClose }: StopSheetProps) {
  const evidence = evidenceOf(point.level);
  return (
    <section className="stopsheet" aria-labelledby="stopsheet-title">
      <div className="stopsheet-head">
        <div>
          <p className="label">{point.code}</p>
          <h2 className="stopsheet-title" id="stopsheet-title">
            {point.name}
          </h2>
        </div>
        <button type="button" className="link-button" onClick={onClose}>
          Tutup
        </button>
      </div>

      <dl className="facts">
        <div>
          <dt>Level bukti</dt>
          <dd>
            <span className="level" data-level={point.level}>
              {evidence.label}
            </span>
          </dd>
        </div>
        <div>
          <dt>Episode tercatat</dt>
          <dd>{point.episodes === 0 ? 'Belum ada' : formatNumber(point.episodes, 0)}</dd>
        </div>
        <div>
          <dt>Status halte</dt>
          <dd>{point.active ? 'Aktif' : 'Tidak aktif'}</dd>
        </div>
        {point.isDemo ? (
          <div>
            <dt>Sumber</dt>
            <dd>Data simulasi</dd>
          </div>
        ) : null}
      </dl>

      <p className="stopsheet-note">{evidence.detail}</p>

      <div className="actions">
        <Link to="/s/$stopCode" params={{ stopCode: point.code }} className="btn">
          Buka halte
        </Link>
      </div>
    </section>
  );
}