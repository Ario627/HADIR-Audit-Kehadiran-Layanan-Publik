import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  experimentArm,
  institutionKind,
  reportCategory,
  sourceTier,
  timestamps,
  triageVerdict,
  uuidv7PrimaryKey,
} from './common';
import { cities, routes, stops } from './reference';
import { reports } from './reports';

export const institutions = pgTable(
  'institutions',
  {
    id: uuidv7PrimaryKey(),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    kind: institutionKind('kind').notNull().default('other'),
    officialSiteUrl: text('official_site_url'),
    ...timestamps(),
  },
  (table) => [
    index('ix_institutions_city').on(table.cityId, table.kind),
    check('ck_institutions_name_length', sql`char_length(${table.name}) BETWEEN 1 AND 160`),
    check(
      'ck_institutions_site_length',
      sql`${table.officialSiteUrl} IS NULL OR char_length(${table.officialSiteUrl}) <= 500`,
    ),
  ],
);

export const authorityMap = pgTable(
  'authority_map',
  {
    id: uuidv7PrimaryKey(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    assetKind: text('asset_kind').notNull(),
    assetRef: text('asset_ref').notNull(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    sourceUrl: text('source_url').notNull(),
    verified: boolean('verified').notNull().default(false),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_authority_map').on(table.cityId, table.assetKind, table.assetRef),
    index('ix_authority_institution').on(table.institutionId),
    check(
      'ck_authority_asset_kind',
      sql`${table.assetKind} IN ('road', 'stop', 'route', 'terminal', 'sidewalk')`,
    ),
    check(
      'ck_authority_asset_ref_length',
      sql`char_length(${table.assetRef}) BETWEEN 1 AND 80`,
    ),
    check(
      'ck_authority_source_length',
      sql`char_length(${table.sourceUrl}) BETWEEN 1 AND 500`,
    ),
    check(
      'ck_authority_note_length',
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`,
    ),
  ],
);

export const notices = pgTable(
  'notices',
  {
    id: uuidv7PrimaryKey(),
    kind: text('kind').notNull(),
    cityId: uuid('city_id').references(() => cities.id, { onDelete: 'cascade' }),
    stopId: uuid('stop_id').references(() => stops.id, { onDelete: 'cascade' }),
    routeId: uuid('route_id').references(() => routes.id, { onDelete: 'cascade' }),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    text: text('text').notNull(),
    sourceUrl: text('source_url').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ix_notices_stop').on(table.stopId, table.startsAt.desc()),
    index('ix_notices_route').on(table.routeId, table.startsAt.desc()),
    index('ix_notices_city').on(table.cityId, table.startsAt.desc()),
    check('ck_notices_text_length', sql`char_length(${table.text}) BETWEEN 1 AND 1000`),
    check(
      'ck_notices_source_length',
      sql`char_length(${table.sourceUrl}) BETWEEN 1 AND 500`,
    ),
    check(
      'ck_notices_window',
      sql`${table.startsAt} IS NULL OR ${table.endsAt} IS NULL OR ${table.startsAt} <= ${table.endsAt}`,
    ),
    check(
      'ck_notices_target',
      sql`${table.cityId} IS NOT NULL OR ${table.stopId} IS NOT NULL OR ${table.routeId} IS NOT NULL`,
    ),
  ],
);

export const evidenceItems = pgTable(
  'evidence_items',
  {
    id: uuidv7PrimaryKey(),
    claim: text('claim').notNull(),
    tier: sourceTier('tier').notNull(),
    sourceType: text('source_type').notNull(),
    sourceUrl: text('source_url'),
    retrievedAt: timestamp('retrieved_at', { withTimezone: true, mode: 'date' }).notNull(),
    validUntil: date('valid_until'),
    confidence: real('confidence').notNull().default(0.5),
    matchMethod: text('match_method'),
    matchScore: real('match_score'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ix_evidence_tier').on(table.tier, table.sourceType),
    index('ix_evidence_valid').on(table.validUntil),
    index('ix_evidence_payload').using('gin', table.payload),
    check('ck_evidence_claim_length', sql`char_length(${table.claim}) BETWEEN 1 AND 400`),
    check(
      'ck_evidence_source_type',
      sql`char_length(${table.sourceType}) BETWEEN 1 AND 40`,
    ),
    check('ck_evidence_confidence', sql`${table.confidence} BETWEEN 0 AND 1`),
    check(
      'ck_evidence_match',
      sql`${table.matchScore} IS NULL OR ${table.matchScore} BETWEEN 0 AND 1`,
    ),
    check(
      'ck_evidence_url_length',
      sql`${table.sourceUrl} IS NULL OR char_length(${table.sourceUrl}) <= 500`,
    ),
  ],
);

export const triageSessions = pgTable(
  'triage_sessions',
  {
    id: uuidv7PrimaryKey(),
    deviceHash: text('device_hash').notNull(),
    deviceDayHash: text('device_day_hash').notNull(),
    clientEventId: uuid('client_event_id').notNull(),
    stopId: uuid('stop_id').references(() => stops.id, { onDelete: 'set null' }),
    routeId: uuid('route_id').references(() => routes.id, { onDelete: 'set null' }),
    category: reportCategory('category').notNull(),
    verdict: triageVerdict('verdict').notNull(),
    overridden: boolean('overridden').notNull().default(false),
    evidenceIds: uuid('evidence_ids').array().notNull().default(sql`'{}'::uuid[]`),
    arm: experimentArm('arm').notNull().default('triage'),
    rulesVer: text('rules_ver').notNull(),
    latencyMs: integer('latency_ms'),
    connectors: jsonb('connectors')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    completedReportId: uuid('completed_report_id').references(() => reports.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_triage_client_event').on(table.deviceHash, table.clientEventId),
    index('ix_triage_created').on(table.createdAt.desc()),
    index('ix_triage_verdict').on(table.verdict, table.overridden),
    index('ix_triage_stop').on(table.stopId, table.createdAt.desc()),
    check('ck_triage_rules_ver', sql`char_length(${table.rulesVer}) BETWEEN 1 AND 40`),
    check(
      'ck_triage_latency',
      sql`${table.latencyMs} IS NULL OR ${table.latencyMs} >= 0`,
    ),
    check('ck_triage_device', sql`${table.deviceHash} ~ '^[a-f0-9]{64}$'`),
    check('ck_triage_device_day', sql`${table.deviceDayHash} ~ '^[a-f0-9]{64}$'`),
    check(
      'ck_triage_client_event_version',
      sql`substring(${table.clientEventId}::text, 15, 1) = '7'`,
    ),
  ],
);

export type Institution = typeof institutions.$inferSelect;
export type AuthorityMapEntry = typeof authorityMap.$inferSelect;
export type Notice = typeof notices.$inferSelect;
export type EvidenceItem = typeof evidenceItems.$inferSelect;
export type TriageSession = typeof triageSessions.$inferSelect;