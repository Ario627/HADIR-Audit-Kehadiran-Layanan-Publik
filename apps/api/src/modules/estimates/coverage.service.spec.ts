import type { RouteSummary, StopDetail } from '@hadir/contracts';
import { env } from '../../common/config/env';
import type {
  CoverageCellRow,
  CoverageFilters,
  CoverageSummaryDbRow,
  EstimatesRepository,
} from '../../db/repositories/estimates.repository';
import type { StopsService } from '../stops/stops.service';
import { EstimatesService, type CoverageRequest } from './estimates.service';

const STOP_ID = '0192f0c4-0000-7000-8000-0000000000aa';
const ROUTE_ID = '0192f0c4-0000-7000-8000-0000000000bb';

const ROUTE: RouteSummary = {
  id: ROUTE_ID,
  code: 'K3A',
  name: 'Terminal - Kampus',
  promisedHeadwayPeakMin: 15,
  headwaySourceUrl: null,
};

function stop(): StopDetail {
  return {
    id: STOP_ID,
    code: 'BMS-A12',
    name: 'Halte UMP',
    location: { lat: -7.4112, lon: 109.2418 },
    status: 'active',
    isDemo: false,
    routes: [ROUTE],
    description: null,
    geofenceRadiusM: 150,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function cell(overrides: Partial<CoverageCellRow> = {}): CoverageCellRow {
  return {
    stopId: STOP_ID,
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    hour: 7,
    n: 20,
    devices: 12,
    days: 4,
    ...overrides,
  };
}

function summaryRow(overrides: Partial<CoverageSummaryDbRow> = {}): CoverageSummaryDbRow {
  return {
    stopId: STOP_ID,
    stopCode: 'BMS-A12',
    stopName: 'Halte UMP',
    n: 120,
    devices: 30,
    days: 6,
    clusters: 20,
    hoursCovered: 8,
    ...overrides,
  };
}

interface RepositoryCalls {
  coverage: number;
  summary: number;
  filters: CoverageFilters | null;
}

function repositoryDouble(
  cells: CoverageCellRow[],
  rows: CoverageSummaryDbRow[],
  calls: RepositoryCalls,
): EstimatesRepository {
  return {
    loadCoverage: async (filters: CoverageFilters) => {
      calls.coverage += 1;
      calls.filters = filters;
      return cells;
    },
    loadCoverageSummary: async (filters: CoverageFilters) => {
      calls.summary += 1;
      calls.filters = filters;
      return rows;
    },
  } as unknown as EstimatesRepository;
}

function stopsDouble(): StopsService {
  return { getById: async () => stop() } as unknown as StopsService;
}

function buildService(
  cells: CoverageCellRow[],
  rows: CoverageSummaryDbRow[],
  calls: RepositoryCalls,
): EstimatesService {
  return new EstimatesService(stopsDouble(), repositoryDouble(cells, rows, calls));
}

function freshCalls(): RepositoryCalls {
  return { coverage: 0, summary: 0, filters: null };
}

function request(overrides: Partial<CoverageRequest> = {}): CoverageRequest {
  return { period: '7d', routeId: null, bbox: null, ...overrides };
}

describe('EstimatesService.coverage', () => {
  it('marks sparse cells as none and populated cells as indication', async () => {
    const calls = freshCalls();
    const service = buildService(
      [
        cell({ hour: 5, n: 4, devices: 3, days: 2 }),
        cell({ hour: 7, n: 22, devices: 11, days: 4 }),
        cell({ hour: 8, n: 15, devices: 10, days: 3 }),
      ],
      [],
      calls,
    );

    const result = await service.coverage(request());

    expect(result.period).toBe('7d');
    expect(result.cells.map((item) => item.level)).toEqual([
      'none',
      'indication',
      'indication',
    ]);
  });

  it('never promotes a single high-volume hour above indication', async () => {
    const calls = freshCalls();
    const service = buildService(
      [cell({ n: 4_000, devices: 900, days: 30 })],
      [],
      calls,
    );

    const result = await service.coverage(request({ period: '30d' }));

    expect(result.cells[0]?.level).toBe('indication');
  });

  it('serves repeated reads from the coverage cache', async () => {
    const calls = freshCalls();
    const service = buildService([cell()], [], calls);

    await service.coverage(request());
    await service.coverage(request());

    expect(calls.coverage).toBe(1);
  });

  it('separates cache entries per bounding box', async () => {
    const calls = freshCalls();
    const service = buildService([cell()], [], calls);
    const bbox = { minLon: 109.2, minLat: -7.5, maxLon: 109.3, maxLat: -7.4 };

    await service.coverage(request());
    await service.coverage(request({ bbox }));
    await service.coverage(request({ bbox }));

    expect(calls.coverage).toBe(2);
  });

  it('passes the demo gate and corridor filter to the repository', async () => {
    const calls = freshCalls();
    const service = buildService([cell()], [], calls);

    await service.coverage(request({ routeId: ROUTE_ID, period: '30d' }));

    expect(calls.filters).toMatchObject({
      routeId: ROUTE_ID,
      includeSimulated: env.devTools,
      bbox: null,
    });
    expect(calls.filters?.end.getTime()).toBeGreaterThan(calls.filters?.start.getTime() ?? 0);
  });
});

describe('EstimatesService.coverageSummary', () => {
  it('reports cluster and hour counts alongside the level', async () => {
    const calls = freshCalls();
    const service = buildService([], [summaryRow()], calls);

    const result = await service.coverageSummary(request());

    expect(result.stops[0]).toMatchObject({
      n: 120,
      devices: 30,
      days: 6,
      clusters: 20,
      hoursCovered: 8,
      level: 'indication',
    });
  });

  it('keeps a stop without enough clusters at none', async () => {
    const calls = freshCalls();
    const service = buildService(
      [],
      [summaryRow({ n: 400, clusters: 2, days: 1 })],
      calls,
    );

    const result = await service.coverageSummary(request());

    expect(result.stops[0]?.level).toBe('none');
  });

  it('uses a different cache key from the cell view', async () => {
    const calls = freshCalls();
    const service = buildService([cell()], [summaryRow()], calls);

    await service.coverage(request());
    await service.coverageSummary(request());

    expect(calls.coverage).toBe(1);
    expect(calls.summary).toBe(1);
  });
});
