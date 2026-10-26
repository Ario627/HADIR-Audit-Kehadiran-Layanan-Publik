import { Inject, Injectable } from '@nestjs/common';
import type { ListStopsQuery, RouteSummary, StopDetail, StopSummary } from '@hadir/contracts';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';
import { cities, routeStops, routes, stops } from '../schema';
import { AppError } from '../../common/errors/app-error';
import { parseBbox } from '../../common/geo/bbox';
import { decodeCursor, encodeCursor } from '../../common/http/cursor';

interface StopRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  geofenceRadiusM: number;
  status: 'active' | 'inactive' | 'moved' | 'planned';
  isDemo: boolean;
  createdAt: Date;
  lat: number;
  lon: number;
}

interface RouteRow {
  stopId: string;
  id: string;
  code: string;
  name: string;
  promisedHeadwayPeakMin: number | null;
  headwaySourceUrl: string | null;
}

export interface StopListResult {
  items: StopSummary[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface RouteListQuery {
  city?: string;
  limit: number;
  cursor?: string;
}

export interface RouteRecord {
  id: string;
  code: string;
  name: string;
  mode: 'brt' | 'non_brt' | 'feeder' | 'other';
  status: 'active' | 'suspended' | 'stopped' | 'planned';
  promisedHeadwayPeakMin: number | null;
  promisedHeadwayOffMin: number | null;
  headwaySourceUrl: string | null;
  headwayValidFrom: string | null;
  headwayValidTo: string | null;
  stopCount: number;
}

export interface RouteListResult {
  items: RouteRecord[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface RouteStopRecord {
  stopId: string;
  stopCode: string;
  stopName: string;
  direction: number;
  seq: number;
  status: 'active' | 'inactive' | 'moved' | 'planned';
}

export const routeRepositoryLimits = Object.freeze({
  maxRouteStops: 500,
  maxRoutesPerPage: 100,
});

const stopSelection = {
  id: stops.id,
  code: stops.code,
  name: stops.name,
  description: stops.description,
  geofenceRadiusM: stops.geofenceRadiusM,
  status: stops.status,
  isDemo: stops.isDemo,
  createdAt: stops.createdAt,
  lat: sql<number>`ST_Y(${stops.geom}::geometry)`,
  lon: sql<number>`ST_X(${stops.geom}::geometry)`,
};

const routeSelection = {
  stopId: routeStops.stopId,
  id: routes.id,
  code: routes.code,
  name: routes.name,
  promisedHeadwayPeakMin: routes.promisedHeadwayPeakMin,
  headwaySourceUrl: routes.headwaySourceUrl,
};

const routeListSelection = {
  id: routes.id,
  code: routes.code,
  name: routes.name,
  mode: routes.mode,
  status: routes.status,
  promisedHeadwayPeakMin: routes.promisedHeadwayPeakMin,
  promisedHeadwayOffMin: routes.promisedHeadwayOffMin,
  headwaySourceUrl: routes.headwaySourceUrl,
  headwayValidFrom: routes.headwayValidFrom,
  headwayValidTo: routes.headwayValidTo,
  createdAt: routes.createdAt,
  stopCount: sql<number>`count(${routeStops.stopId})::int`,
};

const routeStopSelection = {
  stopId: routeStops.stopId,
  stopCode: stops.code,
  stopName: stops.name,
  direction: routeStops.direction,
  seq: routeStops.seq,
  status: stops.status,
};

function toRouteRecord(row: {
  id: string;
  code: string;
  name: string;
  mode: RouteRecord['mode'];
  status: RouteRecord['status'];
  promisedHeadwayPeakMin: number | null;
  promisedHeadwayOffMin: number | null;
  headwaySourceUrl: string | null;
  headwayValidFrom: string | null;
  headwayValidTo: string | null;
  stopCount: number;
}): RouteRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    mode: row.mode,
    status: row.status,
    promisedHeadwayPeakMin: row.promisedHeadwayPeakMin,
    promisedHeadwayOffMin: row.promisedHeadwayOffMin,
    headwaySourceUrl: row.headwaySourceUrl,
    headwayValidFrom: row.headwayValidFrom,
    headwayValidTo: row.headwayValidTo,
    stopCount: Number(row.stopCount),
  };
}

function escapeLike(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_');
}

function mapRoutes(rows: RouteRow[]): Map<string, RouteSummary[]> {
  const grouped = new Map<string, RouteSummary[]>();
  for (const row of rows) {
    const existing = grouped.get(row.stopId) ?? [];
    existing.push({
      id: row.id,
      code: row.code,
      name: row.name,
      promisedHeadwayPeakMin: row.promisedHeadwayPeakMin,
      headwaySourceUrl: row.headwaySourceUrl,
    });
    grouped.set(row.stopId, existing);
  }
  return grouped;
}

function toSummary(row: StopRow, grouped: Map<string, RouteSummary[]>): StopSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    location: {
      lat: Number(row.lat),
      lon: Number(row.lon),
    },
    status: row.status,
    isDemo: row.isDemo,
    routes: grouped.get(row.id) ?? [],
  };
}

function toDetail(row: StopRow, grouped: Map<string, RouteSummary[]>): StopDetail {
  return {
    ...toSummary(row, grouped),
    description: row.description,
    geofenceRadiusM: row.geofenceRadiusM,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class StopsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async loadRoutes(stopIds: readonly string[]): Promise<Map<string, RouteSummary[]>> {
    if (stopIds.length === 0) {
      return new Map<string, RouteSummary[]>();
    }
    const rows = await this.db
      .select(routeSelection)
      .from(routeStops)
      .innerJoin(routes, eq(routeStops.routeId, routes.id))
      .where(inArray(routeStops.stopId, [...stopIds]))
      .orderBy(asc(routes.code), asc(routeStops.direction), asc(routeStops.seq));
    return mapRoutes(rows);
  }

  async list(input: ListStopsQuery): Promise<StopListResult> {
    const conditions: SQL[] = [];
    if (input.q !== undefined) {
      conditions.push(
        sql`${stops.name} ILIKE ${`%${escapeLike(input.q)}%`} ESCAPE '\\'`,
      );
    }
    if (input.city !== undefined) {
      conditions.push(eq(cities.code, input.city));
    }
    const bbox = input.bbox === undefined ? null : parseBbox(input.bbox);
    if (input.bbox !== undefined && bbox === null) {
      throw new AppError('VALIDATION_FAILED', {
        detail: 'bbox tidak valid.',
        errors: [
          {
            field: 'bbox',
            code: 'invalid_bbox',
            message: 'bbox harus berisi minLon,minLat,maxLon,maxLat yang valid.',
          },
        ],
      });
    }
    if (bbox !== null) {
      conditions.push(
        sql`ST_Intersects(${stops.geom}, ST_SetSRID(ST_MakeEnvelope(${bbox.minLon}, ${bbox.minLat}, ${bbox.maxLon}, ${bbox.maxLat}), 4326)::geography)`,
      );
    }
    if (input.cursor !== undefined) {
      const cursor = decodeCursor(input.cursor);
      conditions.push(
        sql`(${stops.createdAt}, ${stops.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
    }
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = await this.db
      .select(stopSelection)
      .from(stops)
      .innerJoin(cities, eq(stops.cityId, cities.id))
      .where(where)
      .orderBy(desc(stops.createdAt), desc(stops.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const visible = hasMore ? rows.slice(0, input.limit) : rows;
    const grouped = await this.loadRoutes(visible.map((row) => row.id));
    const last = visible[visible.length - 1];
    return {
      items: visible.map((row) => toSummary(row, grouped)),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async findById(id: string): Promise<StopDetail | null> {
    const rows = await this.db
      .select(stopSelection)
      .from(stops)
      .innerJoin(cities, eq(stops.cityId, cities.id))
      .where(eq(stops.id, id))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const grouped = await this.loadRoutes([row.id]);
    return toDetail(row, grouped);
  }

  async findByCode(code: string): Promise<StopDetail | null> {
    const rows = await this.db
      .select(stopSelection)
      .from(stops)
      .innerJoin(cities, eq(stops.cityId, cities.id))
      .where(eq(stops.code, code))
      .limit(1);
    const row = rows[0];
    if (row === undefined) {
      return null;
    }
    const grouped = await this.loadRoutes([row.id]);
    return toDetail(row, grouped);
  }

  async listRoutes(input: RouteListQuery): Promise<RouteListResult> {
    const conditions: SQL[] = [];
    if (input.city !== undefined) {
      conditions.push(eq(cities.code, input.city));
    }
    if (input.cursor !== undefined) {
      const cursor = decodeCursor(input.cursor);
      conditions.push(
        sql`(${routes.createdAt}, ${routes.id}) < (${cursor.createdAt}, ${cursor.id})`,
      );
    }
    const where = conditions.length === 0 ? undefined : and(...conditions);

    const rows = await this.db
      .select(routeListSelection)
      .from(routes)
      .innerJoin(cities, eq(routes.cityId, cities.id))
      .leftJoin(routeStops, eq(routeStops.routeId, routes.id))
      .where(where)
      .groupBy(routes.id, cities.code)
      .orderBy(desc(routes.createdAt), desc(routes.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const visible = hasMore ? rows.slice(0, input.limit) : rows;
    const last = visible[visible.length - 1];
    return {
      items: visible.map(toRouteRecord),
      nextCursor:
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null,
      hasMore,
    };
  }

  async findRouteById(id: string): Promise<RouteRecord | null> {
    const rows = await this.db
      .select(routeListSelection)
      .from(routes)
      .innerJoin(cities, eq(routes.cityId, cities.id))
      .leftJoin(routeStops, eq(routeStops.routeId, routes.id))
      .where(eq(routes.id, id))
      .groupBy(routes.id, cities.code)
      .limit(1);
    const row = rows[0];
    return row === undefined ? null : toRouteRecord(row);
  }

  async listRouteStops(routeId: string): Promise<RouteStopRecord[]> {
    const rows = await this.db
      .select(routeStopSelection)
      .from(routeStops)
      .innerJoin(stops, eq(stops.id, routeStops.stopId))
      .where(eq(routeStops.routeId, routeId))
      .orderBy(asc(routeStops.direction), asc(routeStops.seq))
      .limit(routeRepositoryLimits.maxRouteStops);
    return rows.map((row) => ({
      stopId: row.stopId,
      stopCode: row.stopCode,
      stopName: row.stopName,
      direction: row.direction,
      seq: row.seq,
      status: row.status,
    }));
  }
}