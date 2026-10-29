import { useMemo, useState } from 'react';
import { evidenceOf } from '../../lib/evidence';
import {
  COMPACT_SIZE,
  FULL_SIZE,
  buildGrid,
  buildPlot,
  isZoomedIn,
  panView,
  viewBoxAttr,
  zoomView,
  type MapPoint,
  type PlotSize,
  type ViewBox,
} from '../../lib/map';

export type MapVariant = 'full' | 'compact';

export interface MapPlotProps {
  points: readonly MapPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  variant?: MapVariant;
  labelMode?: 'all' | 'focus';
}

const ZOOM_STEP = 1.6;
const PAN_STEP = 0.18;

const PAN_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-PAN_STEP, 0],
  ArrowRight: [PAN_STEP, 0],
  ArrowUp: [0, -PAN_STEP],
  ArrowDown: [0, PAN_STEP],
};

function sizeOf(variant: MapVariant): PlotSize {
  return variant === 'compact' ? COMPACT_SIZE : FULL_SIZE;
}

export function MapPlot({
  points,
  selectedId,
  onSelect,
  variant = 'full',
  labelMode = 'all',
}: MapPlotProps) {
  const size = sizeOf(variant);
  const fullView = useMemo(() => ({ x: 0, y: 0, w: size.width, h: size.height }), [size]);
  const [view, setView] = useState<ViewBox>(fullView);
  const plot = useMemo(
    () => buildPlot(points, { width: size.width, height: size.height }),
    [points, size.width, size.height],
  );
  const grid = useMemo(() => buildGrid(size.width, size.height, size.gridStep), [size]);
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
          <g className="mapplot-grid" aria-hidden="true">
            {grid.map((line) => (
              <line
                key={`${String(line.x1)}-${String(line.y1)}`}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
              />
            ))}
          </g>
          {plot.points.map((point) => {
            const selected = point.id === selectedId;
            const label = labelMode === 'focus' && !selected ? undefined : labelById.get(point.id);
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
                <circle className="mapplot-hit" cx={point.x} cy={point.y} r={18} />
                <circle
                  className="mapplot-dot"
                  cx={point.x}
                  cy={point.y}
                  r={selected ? size.dotRadius + 2 : size.dotRadius}
                />
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
            setView(fullView);
          }}
        >
          Seluruh halte
        </button>
      </div>

      {plot.scale === null ? null : (
        <p className="mapplot-scale">
          <svg
            className="mapplot-scale-bar"
            viewBox={`0 0 ${String(plot.scale.pixels)} 6`}
            width={plot.scale.pixels}
            height={6}
            aria-hidden="true"
            focusable="false"
          >
            <rect x="0" y="0" width={plot.scale.pixels} height="1" />
            <rect x="0" y="0" width="1" height="6" />
            <rect x={plot.scale.pixels - 1} y="0" width="1" height="6" />
          </svg>
          <span className="mapplot-scale-label">{plot.scale.label}</span>
        </p>
      )}

      <figcaption className="mapplot-caption">
        Skema posisi, bukan peta jalan. Garis skala mengikuti jarak lurus antar halte, bukan rute bus.
        {plot.skipped === 0
          ? null
          : ` ${plot.skipped} nama halte disembunyikan karena berhimpitan; pakai tanda titik untuk membukanya.`}
      </figcaption>
    </figure>
  );
}