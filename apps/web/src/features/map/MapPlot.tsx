import { useMemo, useState } from 'react';
import { evidenceOf } from '../../lib/evidence';
import {
  FULL_VIEW,
  buildPlot,
  isZoomedIn,
  panView,
  viewBoxAttr,
  zoomView,
  type MapPoint,
  type ViewBox,
} from '../../lib/map';

export interface MapPlotProps {
  points: readonly MapPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const ZOOM_STEP = 1.6;
const PAN_STEP = 0.18;

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-PAN_STEP, 0],
  ArrowRight: [PAN_STEP, 0],
  ArrowUp: [0, -PAN_STEP],
  ArrowDown: [0, PAN_STEP],
};

export function MapPlot({ points, selectedId, onSelect }: MapPlotProps) {
  const [view, setView] = useState<ViewBox>(FULL_VIEW);
  const plot = useMemo(() => buildPlot(points), [points]);
  const labelById = useMemo(
    () => new Map(plot.labels.map((label) => [label.id, label])),
    [plot.labels],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.target !== event.currentTarget) {
      return;
    }
    const pan = PAN_KEYS[event.key];
    if (pan !== undefined) {
      event.preventDefault();
      setView((current) => panView(current, pan[0], pan[1]));
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setView((current) => zoomView(current, ZOOM_STEP));
      return;
    }
    if (event.key === '-') {
      event.preventDefault();
      setView((current) => zoomView(current, 1 / ZOOM_STEP));
    }
  };

  return (
    <figure className="mapplot">
      <div
        className="mapplot-stage"
        role="application"
        aria-label="Peta sebaran halte. Panah untuk menggeser, tombol plus dan minus untuk memperbesar."
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <svg
          className="mapplot-svg"
          viewBox={viewBoxAttr(view)}
          role="group"
          aria-label={`Sebaran ${plot.points.length} halte pada bidang datar`}
          preserveAspectRatio="xMidYMid meet"
        >
          {plot.points.map((point) => {
            const label = labelById.get(point.id);
            const selected = point.id === selectedId;
            return (
              <g
                key={point.id}
                className="mapplot-marker"
                data-level={point.level}
                data-demo={point.isDemo ? 'true' : 'false'}
                data-inactive={point.active ? 'false' : 'true'}
                data-selected={selected ? 'true' : 'false'}
                role="button"
                tabIndex={0}
                aria-label={`${point.code} ${point.name}. ${evidenceOf(point.level).label}. ${point.episodes} episode.`}
                aria-pressed={selected}
                onClick={() => {
                  onSelect(point.id);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') {
                    return;
                  }
                  event.preventDefault();
                  onSelect(point.id);
                }}
              >
                <circle className="mapplot-dot" cx={point.x} cy={point.y} r={selected ? 9 : 7} />
                {label === undefined ? null : (
                  <text
                    className="mapplot-label"
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor === 'end' ? 'end' : 'start'}
                  >
                    {label.text}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mapplot-controls">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setView((current) => zoomView(current, ZOOM_STEP));
          }}
        >
          Perbesar
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setView((current) => zoomView(current, 1 / ZOOM_STEP));
          }}
        >
          Perkecil
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!isZoomedIn(view)}
          onClick={() => {
            setView(FULL_VIEW);
          }}
        >
          Seluruh halte
        </button>
      </div>

      <figcaption className="mapplot-caption">
        Skema posisi, bukan peta jalan. Garis skala mengikuti jarak lurus antar halte, bukan rute bus.
        {plot.skipped === 0
          ? null
          : ` ${plot.skipped} nama halte disembunyikan karena berhimpitan; pakai tanda titik untuk membukanya.`}
      </figcaption>
    </figure>
  );
}