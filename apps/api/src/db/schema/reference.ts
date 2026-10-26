import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  dayType,
  geography,
  routeMode,
  serviceStatus,
  stopStatus,
  timestamps,
  uuidv7PrimaryKey,
} from './common';

export const cities = pgTable(
  'cities',
  {
    id: uuidv7PrimaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    timezone: text('timezone').notNull().default('Asia/Jakarta'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_cities_code').on(table.code),
    check('ck_cities_code_format', sql`${table.code} ~ '^[A-Z]{2,8}$'`),
    check('ck_cities_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 120`),
  ],
);

export const routes = pgTable(
  'routes',
  {
    id: uuidv7PrimaryKey(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    mode: routeMode('mode').notNull().default('feeder'),
    promisedHeadwayPeakMin: integer('promised_headway_peak_min'),
    promisedHeadwayOffMin: integer('promised_headway_off_min'),
    headwaySourceUrl: text('headway_source_url'),
    headwayValidFrom: date('headway_valid_from'),
    headwayValidTo: date('headway_valid_to'),
    status: serviceStatus('status').notNull().default('active'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_routes_city_code').on(table.cityId, table.code),
    check('ck_routes_code_format', sql`${table.code} ~ '^[A-Z0-9]{1,12}$'`),
    check('ck_routes_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 120`),
    check(
      'ck_routes_headway_peak',
      sql`${table.promisedHeadwayPeakMin} IS NULL OR ${table.promisedHeadwayPeakMin} > 0`,
    ),
    check(
      'ck_routes_headway_off',
      sql`${table.promisedHeadwayOffMin} IS NULL OR ${table.promisedHeadwayOffMin} > 0`,
    ),
    check(
      'ck_routes_headway_period',
      sql`${table.headwayValidFrom} IS NULL OR ${table.headwayValidTo} IS NULL OR ${table.headwayValidFrom} <= ${table.headwayValidTo}`,
    ),
  ],
);

export const stops = pgTable(
  'stops',
  {
    id: uuidv7PrimaryKey(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    geom: geography('geom').notNull(),
    geofenceRadiusM: integer('geofence_radius_m').notNull().default(150),
    status: stopStatus('status').notNull().default('active'),
    qrAssetUrl: text('qr_asset_url'),
    isDemo: boolean('is_demo').notNull().default(false),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_stops_city_code').on(table.cityId, table.code),
    uniqueIndex('uq_stops_code_global').on(table.code),
    check('ck_stops_code_format', sql`${table.code} ~ '^[A-Z0-9][A-Z0-9-]{2,11}$'`),
    check('ck_stops_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 160`),
    index('ix_stops_geom').using('gist', table.geom),
    index('ix_stops_name_trgm').using('gin', sql`${table.name} gin_trgm_ops`),
    index('ix_stops_created_id').on(table.createdAt.desc(), table.id.desc()),
    check(
      'ck_stops_geofence_radius',
      sql`${table.geofenceRadiusM} BETWEEN 50 AND 500`,
    ),
    check(
      'ck_stops_description_length',
      sql`${table.description} IS NULL OR char_length(${table.description}) <= 500`,
    ),
    check(
      'ck_stops_geom_point',
      sql`ST_SRID(${table.geom}::geometry) = 4326 AND ST_GeometryType(${table.geom}::geometry) = 'ST_Point'`,
    ),
    check(
      'ck_stops_qr_asset_url_length',
      sql`${table.qrAssetUrl} IS NULL OR char_length(${table.qrAssetUrl}) <= 500`,
    ),
  ],
);

export const routeStops = pgTable(
  'route_stops',
  {
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    stopId: uuid('stop_id')
      .notNull()
      .references(() => stops.id, { onDelete: 'cascade' }),
    direction: smallint('direction').notNull().default(0),
    seq: integer('seq').notNull(),
  },
  (table) => [
    uniqueIndex('uq_route_stops_stop').on(table.routeId, table.direction, table.stopId),
    index('ix_route_stops_stop').on(table.stopId),
    check('ck_route_stops_direction', sql`${table.direction} IN (0, 1)`),
    check('ck_route_stops_seq', sql`${table.seq} >= 0`),
  ],
);

export const routeServiceWindows = pgTable(
  'route_service_windows',
  {
    id: uuidv7PrimaryKey(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    dayType: dayType('day_type').notNull(),
    startTime: time('start_time', { precision: 0 }).notNull(),
    endTime: time('end_time', { precision: 0 }).notNull(),
    headwayMin: integer('headway_min').notNull(),
    sourceUrl: text('source_url'),
  },
  (table) => [
    check('ck_route_windows_order', sql`${table.endTime} > ${table.startTime}`),
    check('ck_route_windows_headway', sql`${table.headwayMin} > 0`),
    index('ix_route_windows_route').on(table.routeId, table.dayType),
  ],
);

export type City = typeof cities.$inferSelect;
export type Route = typeof routes.$inferSelect;
export type Stop = typeof stops.$inferSelect;
export type RouteStop = typeof routeStops.$inferSelect;
export type RouteServiceWindow = typeof routeServiceWindows.$inferSelect;