import { evidenceOf } from '../../lib/evidence';
import type { MapPoint } from '../../lib/map';

export interface MapLegendProps {
  points: readonly MapPoint[];
}

export function MapLegend({ points }: MapLegendProps) {
  const counts = new Map<string, number>();
  for (const point of points) {
    counts.set(point.level, (counts.get(point.level) ?? 0) + 1);
  }
  const levels = ['none', 'indication', 'strong', 'field_verified'] as const;

  return (
    <ul className="maplegend" aria-label="Keterangan titik peta">
      {levels.map((level) => (
        <li key={level} className="maplegend-item">
          <span className="maplegend-dot" data-level={level} aria-hidden="true" />
          <span>{evidenceOf(level).label}</span>
          <span className="maplegend-count">{counts.get(level) ?? 0}</span>
        </li>
      ))}
    </ul>
  );
}