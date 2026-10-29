import { describe, expect, it } from 'vitest';
import type { StopSummary } from '@hadir/contracts';
import type { BoardRow } from './board';
import {
  FULL_VIEW,
  MIN_ZOOM_W,
  PLOT_HEIGHT,
  PLOT_WIDTH,
  boxesOverlap,
  buildPlot,
  centerOf,
  isZoomedIn,
  labelBox,
  mapPointsOf,
  panView,
  placeLabels,
  scaleFor,
  shortLabel,
  toLocalMeters,
  viewBoxAttr,
  zoomView,
  type MapPoint,
  type PlotPoint,
} from './map';

function point(overrides: Partial<MapPoint> & { code: string }): MapPoint {
  return {
    id: `id-${overrides.code}`,
    code: overrides.code,
    name: overrides.name ?? `Halte ${overrides.code}`,
    lat: overrides.lat ?? -7.42,
    lon: overrides.lon ?? 109.24,
    level: overrides.level ?? 'none',
    episodes: overrides.episodes ?? 0,
    isDemo: overrides.isDemo ?? false,
    active: overrides.active ?? true,
  };
}

function stop(overrides: Partial<StopSummary> & { code: string }): StopSummary {
  return {
    id: `id-${overrides.code}`,
    location: { lat: -7.42, lon: 109.24 },
    status: 'active',
    isDemo: false,
    routes: [],
    ...overrides,
  } as StopSummary;
}

function row(overrides: Partial<BoardRow> & { stopId: string; code: string }): BoardRow {
  return {
    name: `Halte ${overrides.code}`,
    status: 'active',
    isDemo: false,
    corridors: [],
    promiseMinutes: null,
    promiseSource: null,
    episodes: 0,
    devices: 0,
    days: 0,
    level: 'none',
    ...overrides,
  };
}

describe('toLocalMeters', () => {
  it('converts one degree of latitude to metres', () => {
    const north = toLocalMeters({ lat: 1, lon: 0 }, 0, 0);
    expect(north.y).toBeCloseTo(-111_320, 0);
    expect(north.x).toBe(0);
  });

  it('compresses longitude by the cosine of latitude', () => {
    const equator = toLocalMeters({ lat: 0, lon: 1 }, 0, 0);
    const sixty = toLocalMeters({ lat: 60, lon: 1 }, 60, 0);
    expect(equator.x).toBeCloseTo(111_320, 0);
    expect(sixty.x).toBeCloseTo(55_660, 0);
  });

  it('puts north above the origin', () => {
    expect(toLocalMeters({ lat: 1, lon: 0 }, 0, 0).y).toBeLessThan(0);
  });
});

describe('centerOf', () => {
  it('returns the midpoint of the bounding box', () => {
    const center = centerOf([
      point({ code: 'A', lat: -7.4, lon: 109.2 }),
      point({ code: 'B', lat: -7.6, lon: 109.4 }),
    ]);
    expect(center?.lat).toBeCloseTo(-7.5, 8);
    expect(center?.lon).toBeCloseTo(109.3, 8);
  });

  it('returns null without points', () => {
    expect(centerOf([])).toBeNull();
  });
});

describe('scaleFor', () => {
  it('uses the tighter axis', () => {
    expect(scaleFor(1000, 500, 500, 500)).toBeCloseTo(0.5, 8);
  });

  it('never divides by the collapsed axis', () => {
    const scale = scaleFor(0, 0, 100, 100);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeGreaterThan(0);
  });
});

describe('buildPlot', () => {
  it('returns an empty plot without points', () => {
    expect(buildPlot([])).toEqual({
      width: PLOT_WIDTH,
      height: PLOT_HEIGHT,
      points: [],
      labels: [],
      skipped: 0,
      grid: [],
      scale: null,
    });
  });

  it('menggambar gratikula dan skala saat ada halte', () => {
    const plot = buildPlot([
      point({ code: 'A', lat: -7.4, lon: 109.2 }),
      point({ code: 'B', lat: -7.6, lon: 109.4 }),
    ]);
    expect(plot.grid.length).toBeGreaterThan(0);
    expect(plot.scale).not.toBeNull();
    expect(plot.scale?.metres).toBeGreaterThan(0);
    expect(plot.scale?.label).toMatch(/m$|km$/);
  });

  it('centres a single stop', () => {
    const plot = buildPlot([point({ code: 'A' })]);
    expect(plot.points).toHaveLength(1);
    expect(plot.points[0]?.x).toBe(PLOT_WIDTH / 2);
    expect(plot.points[0]?.y).toBe(PLOT_HEIGHT / 2);
  });

  it('keeps every point inside the padding', () => {
    const plot = buildPlot([
      point({ code: 'A', lat: -7.4, lon: 109.2 }),
      point({ code: 'B', lat: -7.6, lon: 109.4 }),
      point({ code: 'C', lat: -7.5, lon: 109.3 }),
    ]);
    for (const entry of plot.points) {
      expect(entry.x).toBeGreaterThan(0);
      expect(entry.x).toBeLessThan(PLOT_WIDTH);
      expect(entry.y).toBeGreaterThan(0);
      expect(entry.y).toBeLessThan(PLOT_HEIGHT);
    }
  });

  it('keeps north above south', () => {
    const plot = buildPlot([
      point({ code: 'N', lat: -7.4, lon: 109.24 }),
      point({ code: 'S', lat: -7.6, lon: 109.24 }),
    ]);
    const north = plot.points.find((entry) => entry.code === 'N');
    const south = plot.points.find((entry) => entry.code === 'S');
    expect(north?.y).toBeLessThan(south?.y ?? 0);
  });

  it('keeps east to the right of west', () => {
    const plot = buildPlot([
      point({ code: 'W', lat: -7.5, lon: 109.1 }),
      point({ code: 'E', lat: -7.5, lon: 109.3 }),
    ]);
    const west = plot.points.find((entry) => entry.code === 'W');
    const east = plot.points.find((entry) => entry.code === 'E');
    expect(west?.x).toBeLessThan(east?.x ?? 0);
  });

  it('preserves aspect ratio for a symmetric cross', () => {
    const halfLat = 500 / 111_320;
    const halfLon = 500 / (111_320 * Math.cos((60 * Math.PI) / 180));
    const plot = buildPlot([
      point({ code: 'N', lat: 60 + halfLat, lon: 0 }),
      point({ code: 'S', lat: 60 - halfLat, lon: 0 }),
      point({ code: 'E', lat: 60, lon: halfLon }),
      point({ code: 'W', lat: 60, lon: -halfLon }),
    ]);
    const at = (code: string) => plot.points.find((entry) => entry.code === code);
    const vertical = Math.abs((at('N')?.y ?? 0) - (at('S')?.y ?? 0));
    const horizontal = Math.abs((at('E')?.x ?? 0) - (at('W')?.x ?? 0));
    expect(Math.abs(vertical - horizontal)).toBeLessThan(1);
  });

  it('produces finite coordinates for coincident stops', () => {
    const plot = buildPlot([
      point({ code: 'A', lat: -7.42, lon: 109.24 }),
      point({ code: 'B', lat: -7.42, lon: 109.24 }),
    ]);
    for (const entry of plot.points) {
      expect(Number.isFinite(entry.x)).toBe(true);
      expect(Number.isFinite(entry.y)).toBe(true);
    }
  });
});

describe('shortLabel', () => {
  it('keeps short names', () => {
    expect(shortLabel('Terminal')).toBe('Terminal');
  });

  it('truncates long names with an ellipsis', () => {
    const label = shortLabel('Halte Pasar Wage Purwokerto Timur');
    expect(label).toHaveLength(20);
    expect(label.endsWith('…')).toBe(true);
  });
});

describe('placeLabels', () => {
  const spread: PlotPoint[] = [
    { ...point({ code: 'A', episodes: 40 }), x: 200, y: 200 },
    { ...point({ code: 'B', episodes: 5 }), x: 206, y: 204 },
    { ...point({ code: 'C', episodes: 0 }), x: 212, y: 208 },
  ];

  it('never overlaps two labels', () => {
    const { labels } = placeLabels(spread, PLOT_WIDTH, PLOT_HEIGHT);
    const boxes = labels.map((label) => labelBox(label));
    for (let index = 0; index < boxes.length; index += 1) {
      for (let other = index + 1; other < boxes.length; other += 1) {
        expect(boxesOverlap(boxes[index] as never, boxes[other] as never)).toBe(false);
      }
    }
  });

  it('prioritises the stop with the most episodes', () => {
    const { labels } = placeLabels(spread, PLOT_WIDTH, PLOT_HEIGHT);
    expect(labels[0]?.id).toBe('id-A');
  });

  it('counts the stops it could not label', () => {
    const { labels, skipped } = placeLabels(spread, PLOT_WIDTH, PLOT_HEIGHT);
    expect(labels.length + skipped).toBe(spread.length);
  });

  it('keeps labels inside the canvas', () => {
    const edge: PlotPoint[] = [{ ...point({ code: 'A' }), x: 4, y: 4 }];
    const { labels } = placeLabels(edge, PLOT_WIDTH, PLOT_HEIGHT);
    for (const label of labels) {
      const box = labelBox(label);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
    }
  });

  it('returns nothing for an empty plot', () => {
    expect(placeLabels([], PLOT_WIDTH, PLOT_HEIGHT)).toEqual({ labels: [], skipped: 0 });
  });
});

describe('boxesOverlap', () => {
  it('detects an intersection', () => {
    expect(
      boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }),
    ).toBe(true);
  });

  it('separates touching boxes', () => {
    expect(
      boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }),
    ).toBe(false);
  });
});

describe('zoomView', () => {
  it('narrows the viewport when zooming in', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    expect(zoomed.w).toBe(PLOT_WIDTH / 2);
    expect(zoomed.h).toBe(PLOT_HEIGHT / 2);
  });

  it('never shrinks below the minimum window', () => {
    let view = FULL_VIEW;
    for (let index = 0; index < 20; index += 1) {
      view = zoomView(view, 3);
    }
    expect(view.w).toBe(MIN_ZOOM_W);
  });

  it('never grows past the full plot', () => {
    let view = FULL_VIEW;
    for (let index = 0; index < 20; index += 1) {
      view = zoomView(view, 0.5);
    }
    expect(view.w).toBe(PLOT_WIDTH);
    expect(view.x).toBe(0);
    expect(view.y).toBe(0);
  });

  it('keeps the focus point anchored', () => {
    const zoomed = zoomView(FULL_VIEW, 2, 0.25, 0.75);
    const focusBefore = FULL_VIEW.x + FULL_VIEW.w * 0.25;
    const focusAfter = zoomed.x + zoomed.w * 0.25;
    expect(focusAfter).toBeCloseTo(focusBefore, 1);
  });

  it('ignores a nonsense factor', () => {
    expect(zoomView(FULL_VIEW, 0)).toEqual(FULL_VIEW);
    expect(zoomView(FULL_VIEW, Number.NaN)).toEqual(FULL_VIEW);
  });
});

describe('panView', () => {
  it('moves by a fraction of the viewport', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    const panned = panView(zoomed, 0.5, 0);
    expect(panned.x).toBeCloseTo(zoomed.x + zoomed.w * 0.5, 1);
  });

  it('clamps at the plot edges', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    const panned = panView(zoomed, 99, 99);
    expect(panned.x + panned.w).toBeLessThanOrEqual(PLOT_WIDTH);
    expect(panned.y + panned.h).toBeLessThanOrEqual(PLOT_HEIGHT);
  });

  it('clamps at the origin', () => {
    const zoomed = zoomView(FULL_VIEW, 2);
    const panned = panView(zoomed, -99, -99);
    expect(panned.x).toBe(0);
    expect(panned.y).toBe(0);
  });
});

describe('viewBoxAttr', () => {
  it('formats four rounded numbers', () => {
    expect(viewBoxAttr({ x: 0, y: 1.234567, w: 1000, h: 640 })).toBe('0 1.23 1000 640');
  });
});

describe('isZoomedIn', () => {
  it('is false for the full view and true after zooming', () => {
    expect(isZoomedIn(FULL_VIEW)).toBe(false);
    expect(isZoomedIn(zoomView(FULL_VIEW, 2))).toBe(true);
  });
});

describe('mapPointsOf', () => {
  it('joins stops with their board row', () => {
    const points = mapPointsOf(
      [stop({ code: 'A', location: { lat: -7.42, lon: 109.24 } })],
      [row({ stopId: 'id-A', code: 'A', episodes: 12, level: 'strong' })],
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({
      code: 'A',
      lat: -7.42,
      lon: 109.24,
      episodes: 12,
      level: 'strong',
      active: true,
    });
  });

  it('drops stops without a board row', () => {
    const points = mapPointsOf([stop({ code: 'A' })], []);
    expect(points).toEqual([]);
  });

  it('marks inactive stops', () => {
    const points = mapPointsOf(
      [stop({ code: 'A', status: 'inactive' })],
      [row({ stopId: 'id-A', code: 'A' })],
    );
    expect(points[0]?.active).toBe(false);
  });

  it('carries the demo flag through', () => {
    const points = mapPointsOf(
      [stop({ code: 'A', isDemo: true })],
      [row({ stopId: 'id-A', code: 'A' })],
    );
    expect(points[0]?.isDemo).toBe(true);
  });
});
