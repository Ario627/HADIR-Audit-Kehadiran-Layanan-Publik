import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, uuidv7PrimaryKey } from './common';
import { platformAdmins } from './admin';
import { institutions } from './triage';

export const anchorLog = pgTable(
  'anchor_log',
  {
    id: uuidv7PrimaryKey(),
    anchorDate: date('anchor_date').notNull(),
    merkleRoot: bytea('merkle_root').notNull(),
    leafCount: integer('leaf_count').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true, mode: 'date' }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true, mode: 'date' }).notNull(),
    txRef: text('tx_ref'),
    proof: jsonb('proof')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    signature: bytea('signature'),
    signatureAlgorithm: text('signature_algorithm'),
    signingKeyId: text('signing_key_id'),
    publicKey: bytea('public_key'),
    signedAt: timestamp('signed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_anchor_log_date').on(table.anchorDate),
    index('ix_anchor_log_key')
      .on(table.signingKeyId, table.anchorDate.desc())
      .where(sql`${table.signingKeyId} IS NOT NULL`),
    check('ck_anchor_log_root', sql`octet_length(${table.merkleRoot}) = 32`),
    check('ck_anchor_log_count', sql`${table.leafCount} >= 0`),
    check('ck_anchor_log_window', sql`${table.windowStart} < ${table.windowEnd}`),
    check(
      'ck_anchor_log_tx',
      sql`${table.txRef} IS NULL OR char_length(${table.txRef}) BETWEEN 1 AND 200`,
    ),
    check(
      'ck_anchor_log_signature_bytes',
      sql`${table.signature} IS NULL OR octet_length(${table.signature}) = 64`,
    ),
    check(
      'ck_anchor_log_public_key_bytes',
      sql`${table.publicKey} IS NULL OR octet_length(${table.publicKey}) = 32`,
    ),
    check(
      'ck_anchor_log_algorithm',
      sql`${table.signatureAlgorithm} IS NULL OR ${table.signatureAlgorithm} IN ('ed25519')`,
    ),
    check(
      'ck_anchor_log_signed_after_window',
      sql`${table.signedAt} IS NULL OR ${table.signedAt} >= ${table.windowEnd}`,
    ),
  ],
);

export const exportJobs = pgTable(
  'exports',
  {
    id: uuidv7PrimaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    requestedBy: uuid('requested_by').notNull(),
    format: text('format').notNull(),
    scope: jsonb('scope')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status').notNull().default('queued'),
    objectKey: text('object_key'),
    rowCount: integer('row_count'),
    byteSize: integer('byte_size'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_exports_institution').on(table.institutionId, table.createdAt.desc()),
    index('ix_exports_expiry')
      .on(table.expiresAt)
      .where(sql`${table.status} = 'ready'`),
    check('ck_exports_format', sql`${table.format} IN ('csv', 'open311')`),
    check(
      'ck_exports_status',
      sql`${table.status} IN ('queued', 'running', 'ready', 'failed', 'expired')`,
    ),
    check('ck_exports_rows', sql`${table.rowCount} IS NULL OR ${table.rowCount} >= 0`),
    check('ck_exports_bytes', sql`${table.byteSize} IS NULL OR ${table.byteSize} >= 0`),
    check(
      'ck_exports_ready',
      sql`(${table.status} = 'ready') = (${table.objectKey} IS NOT NULL)`,
    ),
  ],
);

export const retentionRuns = pgTable(
  'retention_runs',
  {
    id: uuidv7PrimaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true, mode: 'date' }),
    rowsRemoved: integer('rows_removed').notNull().default(0),
    datasets: jsonb('datasets')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    triggeredBy: text('triggered_by').notNull().default('worker'),
    errorCode: text('error_code'),
  },
  (table) => [
    index('ix_retention_runs_started').on(table.startedAt.desc()),
    check('ck_retention_runs_rows', sql`${table.rowsRemoved} >= 0`),
    check(
      'ck_retention_runs_trigger',
      sql`${table.triggeredBy} IN ('worker', 'manual', 'test')`,
    ),
    check(
      'ck_retention_runs_error',
      sql`${table.errorCode} IS NULL OR char_length(${table.errorCode}) <= 80`,
    ),
  ],
);

export const retentionOverrides = pgTable(
  'retention_overrides',
  {
    dataset: text('dataset').primaryKey(),
    retentionDays: integer('retention_days').notNull(),
    reason: text('reason').notNull(),
    updatedBy: uuid('updated_by').references(() => platformAdmins.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      'ck_retention_overrides_dataset',
      sql`${table.dataset} ~ '^[a-z][a-z0-9_.]{2,63}$'`,
    ),
    check(
      'ck_retention_overrides_days',
      sql`${table.retentionDays} BETWEEN 1 AND 3650`,
    ),
    check(
      'ck_retention_overrides_reason',
      sql`char_length(${table.reason}) BETWEEN 10 AND 400`,
    ),
  ],
);

export type AnchorLog = typeof anchorLog.$inferSelect;
export type ExportRecord = typeof exportJobs.$inferSelect;
export type RetentionRun = typeof retentionRuns.$inferSelect;
export type RetentionOverride = typeof retentionOverrides.$inferSelect;
