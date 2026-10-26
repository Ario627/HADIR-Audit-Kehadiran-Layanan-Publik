import { sql } from 'drizzle-orm';
import { customType, pgEnum, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const geography = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'geography';
  },
});

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export function uuidv7PrimaryKey() {
  return uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
}

export function uuidv7(name: string) {
  return uuid(name)
    .notNull()
    .default(sql`uuidv7()`);
}

export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  };
}

export function emptyTextArray(name: string) {
  return text(name)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`);
}

export const routeMode = pgEnum('route_mode', ['brt', 'non_brt', 'feeder', 'other']);
export const serviceStatus = pgEnum('service_status', [
  'active',
  'suspended',
  'stopped',
  'planned',
]);
export const stopStatus = pgEnum('stop_status', ['active', 'inactive', 'moved', 'planned']);
export const dayType = pgEnum('day_type', ['weekday', 'saturday', 'sunday', 'holiday']);
export const startMode = pgEnum('episode_start_mode', [
  'qr',
  'gps_nearby',
  'manual',
  'resume',
  'import',
]);
export const episodeOutcome = pgEnum('episode_outcome', [
  'boarded',
  'abandoned',
  'passed_full',
  'cancelled',
  'timeout',
]);
export const episodePresence = pgEnum('episode_presence', [
  'unverified',
  'qr_only',
  'qr_geo',
  'gps_verified',
  'field_verified',
]);
export const timeSource = pgEnum('episode_time_source', ['server', 'client']);
export const distanceBucket = pgEnum('distance_bucket', [
  '0-50',
  '50-100',
  '100-150',
  '150-300',
  '>300',
]);
export const accuracyBucket = pgEnum('accuracy_bucket', [
  '<=20',
  '21-50',
  '51-80',
  '81-150',
  '>150',
]);
export const auditActorType = pgEnum('audit_actor_type', [
  'citizen',
  'partner',
  'system',
  'moderator',
  'superadmin',
]);
export const sourceTier = pgEnum('source_tier', ['T1', 'T2', 'T3', 'T4']);
export const evidenceLevel = pgEnum('evidence_level', [
  'none',
  'indication',
  'strong',
  'field_verified',
]);
export const triageVerdict = pgEnum('triage_verdict', [
  'join',
  'already_planned',
  'wrong_authority',
  'service_not_running',
  'data_supports',
  'data_insufficient',
  'new_report',
]);
export const experimentArm = pgEnum('experiment_arm', ['control', 'triage']);
export const reportCategory = pgEnum('report_category', [
  'service_wait',
  'service_no_show',
  'service_full',
  'stop_facility',
  'stop_cleanliness',
  'stop_safety',
  'route_info',
  'accessibility',
  'other',
]);
export const reportStatus = pgEnum('report_status', [
  'draft',
  'submitted',
  'triaged',
  'acknowledged',
  'in_progress',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
  'closed',
]);
export const moderationStatus = pgEnum('moderation_status', [
  'pending',
  'approved',
  'rejected',
  'quarantined',
]);
export const reportEventKind = pgEnum('report_event_kind', [
  'submitted',
  'triaged',
  'acknowledged',
  'info_requested',
  'scheduled',
  'responded',
  'claimed_resolved',
  'verified_resolved',
  'disputed',
  'rejected',
  'moderated',
  'corrected',
]);
export const closureAnswer = pgEnum('closure_answer', ['yes', 'no', 'partial']);
export const institutionKind = pgEnum('institution_kind', [
  'dinhub',
  'dishub',
  'pupr',
  'diskominfo',
  'operator',
  'other',
]);
export const noticeKind = pgEnum('notice_kind', [
  'detour',
  'repair',
  'suspension',
  'schedule',
  'other',
]);