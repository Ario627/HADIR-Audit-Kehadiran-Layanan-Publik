import { sql } from 'drizzle-orm';
import {
  check,
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
  auditActorType,
  bytea,
  closureAnswer,
  evidenceLevel,
  moderationStatus,
  reportCategory,
  reportEventKind,
  reportStatus,
  timestamps,
  uuidv7PrimaryKey,
} from './common';
import { routes, stops } from './reference';
import { institutions } from './triage';

export const reports = pgTable(
  'reports',
  {
    id: uuidv7PrimaryKey(),
    publicId: text('public_id').notNull(),
    category: reportCategory('category').notNull(),
    stopId: uuid('stop_id').references(() => stops.id, { onDelete: 'restrict' }),
    routeId: uuid('route_id').references(() => routes.id, { onDelete: 'set null' }),
    deviceHash: text('device_hash').notNull(),
    deviceDayHash: text('device_day_hash').notNull(),
    clientEventId: uuid('client_event_id').notNull(),
    text: text('text').notNull(),
    status: reportStatus('status').notNull().default('submitted'),
    moderation: moderationStatus('moderation').notNull().default('pending'),
    authorityId: uuid('authority_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    institutionId: uuid('institution_id').references(() => institutions.id, {
      onDelete: 'set null',
    }),
    evidenceScore: real('evidence_score').notNull().default(0),
    evidenceLevel: evidenceLevel('evidence_level').notNull().default('none'),
    contactEmailEnc: bytea('contact_email_enc'),
    contactEmailHash: bytea('contact_email_hash'),
    corroborationCount: integer('corroboration_count').notNull().default(0),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_reports_public_id').on(table.publicId),
    uniqueIndex('uq_reports_client_event').on(table.deviceHash, table.clientEventId),
    index('ix_reports_institution').on(
      table.institutionId,
      table.status,
      table.createdAt.desc(),
    ),
    index('ix_reports_stop').on(table.stopId, table.createdAt.desc()),
    index('ix_reports_text_trgm').using('gin', sql`${table.text} gin_trgm_ops`),
    index('ix_reports_moderation').on(table.moderation, table.createdAt.desc()),
    check('ck_reports_text_length', sql`char_length(${table.text}) BETWEEN 20 AND 2000`),
    check(
      'ck_reports_public_id_format',
      sql`${table.publicId} ~ '^LPR-[0-9]{4}-[0-9]{6}$'`,
    ),
    check(
      'ck_reports_evidence_score',
      sql`${table.evidenceScore} BETWEEN 0 AND 1`,
    ),
    check('ck_reports_corroboration', sql`${table.corroborationCount} >= 0`),
    check(
      'ck_reports_client_event_version',
      sql`substring(${table.clientEventId}::text, 15, 1) = '7'`,
    ),
    check('ck_reports_device_hash', sql`${table.deviceHash} ~ '^[a-f0-9]{64}$'`),
    check('ck_reports_device_day_hash', sql`${table.deviceDayHash} ~ '^[a-f0-9]{64}$'`),
  ],
);

export const reportMedia = pgTable(
  'report_media',
  {
    id: uuidv7PrimaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    mime: text('mime').notNull(),
    width: integer('width'),
    height: integer('height'),
    sha256: bytea('sha256'),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_report_media_key').on(table.objectKey),
    index('ix_report_media_report').on(table.reportId, table.createdAt.desc()),
    check('ck_report_media_mime', sql`${table.mime} IN ('image/jpeg', 'image/png', 'image/webp')`),
    check(
      'ck_report_media_dimensions',
      sql`(${table.width} IS NULL AND ${table.height} IS NULL) OR (${table.width} > 0 AND ${table.height} > 0)`,
    ),
    check(
      'ck_report_media_sha',
      sql`${table.sha256} IS NULL OR length(${table.sha256}) = 32`,
    ),
  ],
);

export const reportEvents = pgTable(
  'report_events',
  {
    id: uuidv7PrimaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: reportEventKind('kind').notNull(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: text('actor_id'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceUrl: text('source_url'),
    prevHash: bytea('prev_hash').notNull(),
    payloadHash: bytea('payload_hash').notNull(),
    chainHash: bytea('chain_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_report_events_seq').on(table.reportId, table.seq),
    index('ix_report_events_report').on(table.reportId, table.seq),
    check('ck_report_events_seq', sql`${table.seq} >= 1`),
    check('ck_report_events_prev', sql`length(${table.prevHash}) = 32`),
    check('ck_report_events_payload', sql`length(${table.payloadHash}) = 32`),
    check('ck_report_events_chain', sql`length(${table.chainHash}) = 32`),
    check(
      'ck_report_events_source_length',
      sql`${table.sourceUrl} IS NULL OR char_length(${table.sourceUrl}) <= 500`,
    ),
  ],
);

export const reportCorroborations = pgTable(
  'report_corroborations',
  {
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    deviceHash: text('device_hash').notNull(),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_report_corroboration').on(table.reportId, table.deviceHash),
    check('ck_corroboration_device', sql`${table.deviceHash} ~ '^[a-f0-9]{64}$'`),
    check('ck_corroboration_note', sql`${table.note} IS NULL OR char_length(${table.note}) <= 280`),
  ],
);

export const closureVerifications = pgTable(
  'closure_verifications',
  {
    id: uuidv7PrimaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    deviceHash: text('device_hash').notNull(),
    answer: closureAnswer('answer').notNull(),
    note: text('note'),
    mediaId: uuid('media_id').references(() => reportMedia.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_closure_device').on(table.reportId, table.deviceHash),
    index('ix_closure_report').on(table.reportId, table.createdAt.desc()),
    check('ck_closure_device', sql`${table.deviceHash} ~ '^[a-f0-9]{64}$'`),
    check('ck_closure_note', sql`${table.note} IS NULL OR char_length(${table.note}) <= 280`),
  ],
);

export type Report = typeof reports.$inferSelect;
export type ReportMedia = typeof reportMedia.$inferSelect;
export type ReportEvent = typeof reportEvents.$inferSelect;
export type ReportCorroboration = typeof reportCorroborations.$inferSelect;
export type ClosureVerification = typeof closureVerifications.$inferSelect;