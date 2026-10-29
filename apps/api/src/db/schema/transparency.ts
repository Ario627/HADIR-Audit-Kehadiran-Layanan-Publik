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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_anchor_log_date').on(table.anchorDate),
    check('ck_anchor_log_root', sql`octet_length(${table.merkleRoot}) = 32`),
    check('ck_anchor_log_count', sql`${table.leafCount} >= 0`),
    check('ck_anchor_log_window', sql`${table.windowStart} < ${table.windowEnd}`),
    check(
      'ck_anchor_log_tx',
      sql`${table.txRef} IS NULL OR char_length(${table.txRef}) BETWEEN 1 AND 200`,
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

export type AnchorLog = typeof anchorLog.$inferSelect;
export type ExportRecord = typeof exportJobs.$inferSelect;
