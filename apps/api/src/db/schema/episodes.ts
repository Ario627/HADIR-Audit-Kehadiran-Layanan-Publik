import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  accuracyBucket,
  auditActorType,
  bytea,
  distanceBucket,
  emptyTextArray,
  episodeOutcome,
  episodePresence,
  startMode,
  timeSource,
  timestamps,
  uuidv7,
  uuidv7PrimaryKey,
} from './common';
import { routes, stops } from './reference';

export const devices = pgTable(
  'devices',
  {
    id: uuidv7PrimaryKey(),
    deviceHash: text('device_hash').notNull(),
    firstSeen: timestamp('first_seen', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp('last_seen', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    trustScore: real('trust_score').notNull().default(0.5),
    flags: emptyTextArray('flags'),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_devices_hash').on(table.deviceHash),
    index('ix_devices_last_seen').on(table.lastSeen),
    check('ck_devices_trust', sql`${table.trustScore} BETWEEN 0 AND 1`),
  ],
);

export const waitEpisodes = pgTable(
  'wait_episodes',
  {
    id: uuidv7('id'),
    stopId: uuid('stop_id')
      .notNull()
      .references(() => stops.id, { onDelete: 'restrict' }),
    routeId: uuid('route_id').references(() => routes.id, { onDelete: 'set null' }),
    startMode: startMode('start_mode').notNull(),
    presence: episodePresence('presence').notNull().default('unverified'),
    outcome: episodeOutcome('outcome'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true, mode: 'date' }),
    durationS: integer('duration_s').generatedAlwaysAs(
      sql`CASE WHEN ended_at IS NULL THEN NULL ELSE GREATEST(0, EXTRACT(EPOCH FROM (ended_at - started_at))::integer) END`,
    ),
    clientStartedAt: timestamp('client_started_at', { withTimezone: true, mode: 'date' }),
    clientEndedAt: timestamp('client_ended_at', { withTimezone: true, mode: 'date' }),
    clockSkewMs: integer('clock_skew_ms'),
    timeSource: timeSource('time_source').notNull().default('server'),
    deviceHash: text('device_hash').notNull(),
    deviceDayHash: text('device_day_hash').notNull(),
    clientEventId: uuid('client_event_id').notNull(),
    qrEpoch: text('qr_epoch'),
    qrKeyId: text('qr_key_id'),
    distanceBucket: distanceBucket('distance_bucket'),
    accuracyBucket: accuracyBucket('accuracy_bucket'),
    geoOk: boolean('geo_ok').notNull().default(false),
    trustWeight: real('trust_weight').notNull().default(0.6),
    qualityFlags: emptyTextArray('quality_flags'),
    note: text('note'),
    ...timestamps(),
  },
  (table) => [
    primaryKey({
      name: 'pk_wait_episodes',
      columns: [table.id, table.startedAt],
    }),
    index('ix_wait_episodes_stop_started').on(
      table.stopId,
      table.routeId,
      table.startedAt.desc(),
    ),
    index('ix_wait_episodes_device_started').on(table.deviceHash, table.startedAt.desc()),
    index('ix_wait_episodes_day_hash_started').on(
      table.deviceDayHash,
      table.startedAt.desc(),
    ),
    index('ix_wait_episodes_client_event').on(table.clientEventId),
    index('ix_wait_episodes_active_device')
      .on(table.deviceHash, table.startedAt.desc())
      .where(sql`${table.outcome} IS NULL`),
    check(
      'ck_wait_episodes_time_order',
      sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`,
    ),
    check('ck_wait_episodes_trust', sql`${table.trustWeight} BETWEEN 0 AND 1`),
    check(
      'ck_wait_episodes_note_length',
      sql`${table.note} IS NULL OR char_length(${table.note}) <= 500`,
    ),
    check(
      'ck_wait_episodes_client_event_version',
      sql`substring(${table.clientEventId}::text, 15, 1) = '7'`,
    ),
  ],
);

export const waitEpisodeEvents = pgTable(
  'wait_episode_events',
  {
    id: uuidv7PrimaryKey(),
    episodeId: uuid('episode_id').notNull(),
    episodeStartedAt: timestamp('episode_started_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    seq: integer('seq').notNull(),
    kind: text('kind').notNull(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: text('actor_id'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    prevHash: bytea('prev_hash').notNull(),
    payloadHash: bytea('payload_hash').notNull(),
    chainHash: bytea('chain_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_wait_episode_events_seq').on(table.episodeId, table.seq),
    index('ix_wait_episode_events_episode').on(table.episodeId, table.seq),
    check('ck_wait_episode_events_seq', sql`${table.seq} >= 1`),
    check(
      'ck_wait_episode_events_kind_length',
      sql`char_length(${table.kind}) BETWEEN 1 AND 40`,
    ),
    foreignKey({
      name: 'fk_wait_episode_events_episode',
      columns: [table.episodeId, table.episodeStartedAt],
      foreignColumns: [waitEpisodes.id, waitEpisodes.startedAt],
    }).onDelete('cascade'),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: bytea('request_hash').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: jsonb('response_body').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    primaryKey({
      name: 'pk_idempotency_keys',
      columns: [table.scope, table.key],
    }),
    index('ix_idempotency_keys_expires').on(table.expiresAt),
    check(
      'ck_idempotency_keys_scope_length',
      sql`char_length(${table.scope}) BETWEEN 1 AND 80`,
    ),
    check(
      'ck_idempotency_keys_key_length',
      sql`char_length(${table.key}) BETWEEN 8 AND 128`,
    ),
    check(
      'ck_idempotency_keys_status',
      sql`${table.responseStatus} BETWEEN 0 AND 599`,
    ),
  ],
);

export const outbox = pgTable(
  'outbox',
  {
    id: uuidv7PrimaryKey(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
    attempts: integer('attempts').notNull().default(0),
  },
  (table) => [
    index('ix_outbox_unprocessed')
      .on(table.createdAt)
      .where(sql`${table.processedAt} IS NULL`),
    check('ck_outbox_attempts', sql`${table.attempts} >= 0`),
    check('ck_outbox_topic_length', sql`char_length(${table.topic}) BETWEEN 1 AND 80`),
  ],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuidv7PrimaryKey(),
    actorType: auditActorType('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id'),
    requestId: text('request_id'),
    ipHash: text('ip_hash'),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ix_audit_created_brin').using('brin', table.createdAt),
    index('ix_audit_object').on(table.objectType, table.objectId, table.createdAt.desc()),
    check('ck_audit_action_length', sql`char_length(${table.action}) BETWEEN 1 AND 80`),
    check(
      'ck_audit_object_type_length',
      sql`char_length(${table.objectType}) BETWEEN 1 AND 80`,
    ),
  ],
);

export type Device = typeof devices.$inferSelect;
export type WaitEpisode = typeof waitEpisodes.$inferSelect;
export type WaitEpisodeEvent = typeof waitEpisodeEvents.$inferSelect;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type Outbox = typeof outbox.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;