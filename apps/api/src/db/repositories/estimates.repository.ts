import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';
import { stops, waitEpisodes } from '../schema';
import type { BboxValue } from '../../common/geo/bbox';

export interface EstimateBucketRow {
  day: string;
  hour: number;
  durationS: number;
  outcome: string;
  trustWeight: number;
  count: number;
}

export interface EstimatePopulationRow {
  episodes: number;
  devices: number;
  days: number;
  hasSimulated: boolean;
}

export interface EstimateFilters {
  stopId: string;
  routeId: string | null;
  start: Date;
  end: Date;
  includeSimulated: boolean;
}

export interface CoverageFilters {
  start: Date;
  end: Date;
  routeId: string | null;
  bbox: BboxValue | null;
  includeSimulated: boolean;
}

export interface CoverageCellRow {
  stopId: string;
  stopCode: string;
  stopName: string;
  hour: number;
  n: number;
  devices: number;
  days: number;
}

export interface CoverageSummaryDbRow {
  stopId: string;
  stopCode: string;
  stopName: string;
  n: number;
  devices: number;
  days: number;
  clusters: number;
  hoursCovered: number;
}

const TRUST_FLOOR = 0.6;
const HIGH_TRUST_PROXY = 0.9;
const LOW_TRUST_PROXY = 0.5;
const MIN_DURATION_S = 30;
const DURATION_GRID_S = 5;
const MAX_BUCKET_ROWS = 20_000;
const MAX_COVERAGE_CELLS = 5_000;
const MAX_COVERAGE_STOPS = 2_000;

const dayExpression = sql<string>`to_char(${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
const hourExpression = sql<number>`EXTRACT(HOUR FROM (${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta'))::int`;

function usableEpisodes(): SQL[] {
  return [
    sql`${waitEpisodes.outcome} IS NOT NULL`,
    sql`${waitEpisodes.durationS} IS NOT NULL`,
    sql`${waitEpisodes.durationS} >= ${MIN_DURATION_S}`,
    sql`NOT ('cluster_anomaly' = ANY(${waitEpisodes.qualityFlags}))`,
  ];
}

function coverageWhere(filters: CoverageFilters): SQL {
  const conditions: SQL[] = [
    gte(waitEpisodes.startedAt, filters.start),
    lt(waitEpisodes.startedAt, filters.end),
    ...usableEpisodes(),
  ];
  if (filters.routeId !== null) {
    conditions.push(eq(waitEpisodes.routeId, filters.routeId));
  }
  if (!filters.includeSimulated) {
    conditions.push(sql`NOT ('simulated' = ANY(${waitEpisodes.qualityFlags}))`);
  }
  if (filters.bbox !== null) {
    conditions.push(
      sql`ST_Intersects(${stops.geom}, ST_SetSRID(ST_MakeEnvelope(${filters.bbox.minLon}, ${filters.bbox.minLat}, ${filters.bbox.maxLon}, ${filters.bbox.maxLat}), 4326)::geography)`,
    );
  }
  return and(...conditions) ?? sql`false`;
}

function coverageBase(filters: CoverageFilters): SQL {
  return sql`
    SELECT
      ${waitEpisodes.stopId} AS stop_id,
      ${stops.code} AS stop_code,
      ${stops.name} AS stop_name,
      ${waitEpisodes.deviceHash} AS device_hash,
      ${dayExpression} AS day,
      ${hourExpression} AS hour_bucket
    FROM ${waitEpisodes}
    INNER JOIN ${stops} ON ${stops.id} = ${waitEpisodes.stopId}
    WHERE ${coverageWhere(filters)}
  `;
}

export const estimateRepositoryLimits = Object.freeze({ maxBucketRows: MAX_BUCKET_ROWS });

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function filtersWhere(input: EstimateFilters): SQL {
  const conditions: SQL[] = [
    eq(waitEpisodes.stopId, input.stopId),
    gte(waitEpisodes.startedAt, input.start),
    lt(waitEpisodes.startedAt, input.end),
    sql`${waitEpisodes.outcome} IS NOT NULL`,
    sql`${waitEpisodes.durationS} IS NOT NULL`,
    sql`${waitEpisodes.durationS} >= ${MIN_DURATION_S}`,
    sql`NOT ('cluster_anomaly' = ANY(${waitEpisodes.qualityFlags}))`,
  ];
  if (input.routeId !== null) {
    conditions.push(eq(waitEpisodes.routeId, input.routeId));
  }
  if (!input.includeSimulated) {
    conditions.push(sql`NOT ('simulated' = ANY(${waitEpisodes.qualityFlags}))`);
  }
  return and(...conditions) ?? sql`false`;
}

function mapBucket(row: Record<string, unknown>): EstimateBucketRow | null {
  const day = typeof row.day === 'string' ? row.day : null;
  const hour = toNumber(row.hour_bucket);
  const durationS = toNumber(row.duration_s);
  const outcome = typeof row.outcome === 'string' ? row.outcome : null;
  const count = toNumber(row.n);
  const trustHigh = row.trust_high;

  if (
    day === null ||
    hour === null ||
    durationS === null ||
    outcome === null ||
    count === null ||
    count <= 0 ||
    typeof trustHigh !== 'boolean'
  ) {
    return null;
  }
  return {
    day,
    hour,
    durationS,
    outcome,
    trustWeight: trustHigh ? HIGH_TRUST_PROXY : LOW_TRUST_PROXY,
    count,
  };
}

@Injectable()
export class EstimatesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async loadBuckets(filters: EstimateFilters): Promise<EstimateBucketRow[]> {
    const day = sql<string>`to_char(${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
    const hour = sql<number>`EXTRACT(HOUR FROM (${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta'))::int`;
    const duration = sql<number>`(${waitEpisodes.durationS} / ${DURATION_GRID_S}) * ${DURATION_GRID_S}`;
    const result = await this.db.execute(sql`
      SELECT
        ${day} AS day,
        ${hour} AS hour_bucket,
        ${duration} AS duration_s,
        ${waitEpisodes.outcome}::text AS outcome,
        (${waitEpisodes.trustWeight} >= ${TRUST_FLOOR}) AS trust_high,
        count(*)::int AS n
      FROM ${waitEpisodes}
      WHERE ${filtersWhere(filters)}
      GROUP BY 1, 2, 3, 4, 5
      ORDER BY 1, 2, 3
      LIMIT ${MAX_BUCKET_ROWS}
    `);

    const rows: EstimateBucketRow[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const mapped = mapBucket(raw);
      if (mapped !== null) {
        rows.push(mapped);
      }
    }
    return rows;
  }

  async loadPopulation(filters: EstimateFilters): Promise<EstimatePopulationRow> {
    const result = await this.db.execute(sql`
      SELECT
        count(*)::int AS episodes,
        count(DISTINCT ${waitEpisodes.deviceHash})::int AS devices,
        count(DISTINCT to_char(${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD'))::int AS days,
        coalesce(bool_or('simulated' = ANY(${waitEpisodes.qualityFlags})), false) AS has_simulated
      FROM ${waitEpisodes}
      WHERE ${filtersWhere(filters)}
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      episodes: toNumber(row.episodes) ?? 0,
      devices: toNumber(row.devices) ?? 0,
      days: toNumber(row.days) ?? 0,
      hasSimulated: row.has_simulated === true,
    };
  }

  async loadCoverage(filters: CoverageFilters): Promise<CoverageCellRow[]> {
    const result = await this.db.execute(sql`
      SELECT
        stop_id,
        stop_code,
        stop_name,
        hour_bucket,
        count(*)::int AS n,
        count(DISTINCT device_hash)::int AS devices,
        count(DISTINCT day)::int AS days
      FROM (${coverageBase(filters)}) AS base
      GROUP BY stop_id, stop_code, stop_name, hour_bucket
      ORDER BY stop_code, hour_bucket
      LIMIT ${MAX_COVERAGE_CELLS}
    `);

    const rows: CoverageCellRow[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const stopId = typeof raw.stop_id === 'string' ? raw.stop_id : null;
      const stopCode = typeof raw.stop_code === 'string' ? raw.stop_code : null;
      const stopName = typeof raw.stop_name === 'string' ? raw.stop_name : null;
      const hour = toNumber(raw.hour_bucket);
      const n = toNumber(raw.n);
      const devices = toNumber(raw.devices);
      const days = toNumber(raw.days);
      if (
        stopId === null ||
        stopCode === null ||
        stopName === null ||
        hour === null ||
        n === null ||
        devices === null ||
        days === null
      ) {
        continue;
      }
      rows.push({ stopId, stopCode, stopName, hour, n, devices, days });
    }
    return rows;
  }

  async loadCoverageSummary(filters: CoverageFilters): Promise<CoverageSummaryDbRow[]> {
    const result = await this.db.execute(sql`
      SELECT
        stop_id,
        stop_code,
        stop_name,
        count(*)::int AS n,
        count(DISTINCT device_hash)::int AS devices,
        count(DISTINCT day)::int AS days,
        count(DISTINCT day || ':' || hour_bucket)::int AS clusters,
        count(DISTINCT hour_bucket)::int AS hours_covered
      FROM (${coverageBase(filters)}) AS base
      GROUP BY stop_id, stop_code, stop_name
      ORDER BY stop_code
      LIMIT ${MAX_COVERAGE_STOPS}
    `);

    const rows: CoverageSummaryDbRow[] = [];
    for (const raw of result.rows as Record<string, unknown>[]) {
      const stopId = typeof raw.stop_id === 'string' ? raw.stop_id : null;
      const stopCode = typeof raw.stop_code === 'string' ? raw.stop_code : null;
      const stopName = typeof raw.stop_name === 'string' ? raw.stop_name : null;
      const n = toNumber(raw.n);
      const devices = toNumber(raw.devices);
      const days = toNumber(raw.days);
      const clusters = toNumber(raw.clusters);
      const hoursCovered = toNumber(raw.hours_covered);
      if (
        stopId === null ||
        stopCode === null ||
        stopName === null ||
        n === null ||
        devices === null ||
        days === null ||
        clusters === null ||
        hoursCovered === null
      ) {
        continue;
      }
      rows.push({ stopId, stopCode, stopName, n, devices, days, clusters, hoursCovered });
    }
    return rows;
  }
}