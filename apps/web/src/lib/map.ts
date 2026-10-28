import type { EvidenceLevel, StopSummary } from '@hadir/contracts';
import type { BoardRow } from './board';

export interface MapPoint {
  id: string;
  code: string;
  name: string;
  lat: number;
  lon: number;
  level: EvidenceLevel;
  episodes: number;
  isDemo: boolean;
  active: boolean;
}

export interface PlotPoint extends MapPoint {
  x: number;
  y: number;
}

export interface LabelPlacement {
  id: string;
  text: string;
  x: number;
  y: number;
  anchor: 'start' | 'end';
}

export interface Plot {
  width: number;
  height: number;
  points: PlotPoint[];
  labels: LabelPlacement[];
  skipped: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const PLOT_WIDTH = 1000;
export const PLOT_HEIGHT = 640;
export const MIN_ZOOM_W = 180;

const PLOT_PADDING = 52;
const MIN_SPAN_M = 500;
const METERS_PER_DEGREE_LAT = 111_320;
const LABEL_CHAR_W = 7.4;
const LABEL_HEIGHT = 18;
const LABEL_GAP = 10;
const LABEL_MAX_CHARS = 20;
const MARKER_KEEP_OUT = 16;
const DECIMALS = 2;

export const FULL_VIEW: ViewBox = {
  x: 0,
  y: 0,
  w: PLOT_WIDTH,
  h: PLOT_HEIGHT,
};

function round(value: number): number {
  const factor = 10 ** DECIMALS;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function shortLabel(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length <= LABEL_MAX_CHARS) {
    return trimmed;
  }
  return `${trimmed.slice(0, LABEL_MAX_CHARS - 1).trimEnd()}…`;
}

export function mapPointsOf(
  stops: readonly StopSummary[],
  rows: readonly BoardRow[],
): MapPoint[] {
  const byId = new Map(rows.map((row) => [row.stopId, row]));
  const points: MapPoint[] = [];
  for (const stop of stops) {
    const row = byId.get(stop.id);
    if (row === undefined) {
      continue;
    }
    points.push({
      id: stop.id,
      code: stop.code,
      name: stop.name,
      lat: stop.location.lat,
      lon: stop.location.lon,
      level: row.level,
      episodes: row.episodes,
      isDemo: stop.isDemo,
      active: stop.status === 'active',
    });
  }
  return points;
}

export function toLocalMeters(
  point: { lat: number; lon: number },
  centerLat: number,
  centerLon: number,
): { x: number; y: number } {
  const lonScale = Math.cos((centerLat * Math.PI) / 180);
  return {
    x: (point.lon - centerLon) * METERS_PER_DEGREE_LAT * lonScale,
    y: (centerLat - point.lat) * METERS_PER_DEGREE_LAT,
  };
}

export function centerOf(points: readonly MapPoint[]): { lat: number; lon: number } | null {
  if (points.length === 0) {
    return null;
  }
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minLat = Math.min(minLat, point.lat);
    maxLat = Math.max(maxLat, point.lat);
    minLon = Math.min(minLon, point.lon);
    maxLon = Math.max(maxLon, point.lon);
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

export function scaleFor(
  spanX: number,
  spanY: number,
  availableWidth: number,
  availableHeight: number,
): number {
  const safeX = Math.max(Math.abs(spanX), MIN_SPAN_M);
  const safeY = Math.max(Math.abs(spanY), MIN_SPAN_M);
  return Math.min(availableWidth / safeX, availableHeight / safeY);
}

export function labelBox(placement: LabelPlacement): Box {
  const width = placement.text.length * LABEL_CHAR_W;
  const x = placement.anchor === 'start' ? placement.x : placement.x - width;
  return { x, y: placement.y - LABEL_HEIGHT / 2, w: width, h: LABEL_HEIGHT };
}

export function boxesOverlap(left: Box, right: Box): boolean {
  return (
    left.x < right.x + right.w &&
    right.x < left.x + left.w &&
    left.y < right.y + right.h &&
    right.y < left.y + left.h
  );
}

function insidePlot(box: Box, width: number, height: number): boolean {
  return box.x >= 0 && box.y >= 0 && box.x + box.w <= width && box.y + box.h <= height;
}

function candidatesFor(point: PlotPoint): readonly LabelPlacement[] {
  const text = shortLabel(point.name);
  const y = round(point.y);
  return [
    { id: point.id, text, x: round(point.x + LABEL_GAP), y: round(y + 5), anchor: 'start' },
    { id: point.id, text, x: round(point.x - LABEL_GAP), y: round(y + 5), anchor: 'end' },
    {
      id: point.id,
      text,
      x: round(point.x + LABEL_GAP),
      y: round(y - LABEL_HEIGHT + 2),
      anchor: 'start',
    },
    {
      id: point.id,
      text,
      x: round(point.x - LABEL_GAP),
      y: round(y - LABEL_HEIGHT + 2),
      anchor: 'end',
    },
  ];
}

function byPriority(left: PlotPoint, right: PlotPoint): number {
  if (left.episodes !== right.episodes) {
    return right.episodes - left.episodes;
  }
  return left.code.localeCompare(right.code, 'id');
}

export function placeLabels(
  points: readonly PlotPoint[],
  width: number,
  height: number,
): { labels: LabelPlacement[]; skipped: number } {
  const keepOut: Box[] = points.map((point) => ({
    x: point.x - MARKER_KEEP_OUT / 2,
    y: point.y - MARKER_KEEP_OUT / 2,
    w: MARKER_KEEP_OUT,
    h: MARKER_KEEP_OUT,
  }));
  const labels: LabelPlacement[] = [];
  let skipped = 0;

  for (const point of [...points].sort(byPriority)) {
    let placed = false;
    for (const candidate of candidatesFor(point)) {
      const box = labelBox(candidate);
      if (!insidePlot(box, width, height)) {
        continue;
      }
      if (keepOut.some((taken) => boxesOverlap(box, taken))) {
        continue;
      }
      keepOut.push(box);
      labels.push(candidate);
      placed = true;
      break;
    }
    if (!placed) {
      skipped += 1;
    }
  }

  return { labels, skipped };
}

export function buildPlot(
  points: readonly MapPoint[],
  options: { width?: number; height?: number } = {},
): Plot {
  const width = options.width ?? PLOT_WIDTH;
  const height = options.height ?? PLOT_HEIGHT;
  const center = centerOf(points);
  if (center === null) {
    return { width, height, points: [], labels: [], skipped: 0 };
  }

  const local = points.map((point) => ({
    point,
    local: toLocalMeters(point, center.lat, center.lon),
  }));
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const entry of local) {
    minX = Math.min(minX, entry.local.x);
    maxX = Math.max(maxX, entry.local.x);
    minY = Math.min(minY, entry.local.y);
    maxY = Math.max(maxY, entry.local.y);
  }
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const scale = scaleFor(
    maxX - minX,
    maxY - minY,
    width - PLOT_PADDING * 2,
    height - PLOT_PADDING * 2,
  );

  const projected: PlotPoint[] = local.map((entry) => ({
    ...entry.point,
    x: round(width / 2 + (entry.local.x - midX) * scale),
    y: round(height / 2 + (entry.local.y - midY) * scale),
  }));

  const { labels, skipped } = placeLabels(projected, width, height);
  return { width, height, points: projected, labels, skipped };
}

export function zoomView(view: ViewBox, factor: number, focusX = 0.5, focusY = 0.5): ViewBox {
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const nextW = clamp(view.w / safeFactor, MIN_ZOOM_W, PLOT_WIDTH);
  const ratio = nextW / view.w;
  const nextH = view.h * ratio;
  const anchorX = clamp(focusX, 0, 1);
  const anchorY = clamp(focusY, 0, 1);
  const focusPointX = view.x + view.w * anchorX;
  const focusPointY = view.y + view.h * anchorY;
  return {
    x: round(clamp(focusPointX - nextW * anchorX, 0, PLOT_WIDTH - nextW)),
    y: round(clamp(focusPointY - nextH * anchorY, 0, PLOT_HEIGHT - nextH)),
    w: round(nextW),
    h: round(nextH),
  };
}

export function panView(view: ViewBox, dxRatio: number, dyRatio: number): ViewBox {
  const dx = Number.isFinite(dxRatio) ? dxRatio * view.w : 0;
  const dy = Number.isFinite(dyRatio) ? dyRatio * view.h : 0;
  return {
    x: round(clamp(view.x + dx, 0, PLOT_WIDTH - view.w)),
    y: round(clamp(view.y + dy, 0, PLOT_HEIGHT - view.h)),
    w: view.w,
    h: view.h,
  };
}

export function viewBoxAttr(view: ViewBox): string {
  return [view.x, view.y, view.w, view.h].map((value) => round(value)).join(' ');
}

export function isZoomedIn(view: ViewBox): boolean {
  return view.w < PLOT_WIDTH - 0.5;
}