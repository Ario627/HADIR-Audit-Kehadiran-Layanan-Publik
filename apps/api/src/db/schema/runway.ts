import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  bytea,
  runwayEventKind,
  runwayStatus,
  timestamps,
  uuidv7PrimaryKey,
} from './common';
import { routes } from './reference';

export const serviceRunway = pgTable(
  'service_runway',
  {
    id: uuidv7PrimaryKey(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    status: runwayStatus('status').notNull().default('unknown'),
    fundedUntil: date('funded_until'),
    sourceUrl: text('source_url'),
    decisionDoc: text('decision_doc'),
    decisionDate: date('decision_date'),
    note: text('note'),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_runway_route').on(table.routeId),
    index('ix_runway_status').on(table.status, table.fundedUntil),
    check(
      'ck_runway_source',
      sql`${table.sourceUrl} IS NULL OR char_length(${table.sourceUrl}) BETWEEN 1 AND 500`,
    ),
    check(
      'ck_runway_doc',
      sql`${table.decisionDoc} IS NULL OR char_length(${table.decisionDoc}) <= 500`,
    ),
    check('ck_runway_note', sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`),
  ],
);

export const runwayEvents = pgTable(
  'runway_events',
  {
    id: uuidv7PrimaryKey(),
    runwayId: uuid('runway_id')
      .notNull()
      .references(() => serviceRunway.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    kind: runwayEventKind('kind').notNull(),
    note: text('note').notNull(),
    sourceUrl: text('source_url').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull(),
    prevHash: bytea('prev_hash').notNull(),
    payloadHash: bytea('payload_hash').notNull(),
    chainHash: bytea('chain_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_runway_events_seq').on(table.runwayId, table.seq),
    index('ix_runway_events_runway').on(table.runwayId, table.seq),
    check('ck_runway_events_seq', sql`${table.seq} >= 1`),
    check('ck_runway_events_note', sql`char_length(${table.note}) BETWEEN 1 AND 500`),
    check('ck_runway_events_source', sql`char_length(${table.sourceUrl}) BETWEEN 1 AND 500`),
    check('ck_runway_events_prev', sql`length(${table.prevHash}) = 32`),
    check('ck_runway_events_payload', sql`length(${table.payloadHash}) = 32`),
    check('ck_runway_events_chain', sql`length(${table.chainHash}) = 32`),
  ],
);

export type ServiceRunway = typeof serviceRunway.$inferSelect;
export type RunwayEvent = typeof runwayEvents.$inferSelect;