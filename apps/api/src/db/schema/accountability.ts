import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, emptyTextArray, uuidv7PrimaryKey } from './common';
import { institutions } from './triage';
import { reports } from './reports';

export const responseKind = pgEnum('response_kind', [
  'initial',
  'follow_up',
  'closure_claim',
  'correction',
]);

export const verifierKind = pgEnum('verifier_kind', [
  'citizen',
  'independent_institution',
  'platform',
  'automatic',
]);

export const resolutionMethod = pgEnum('resolution_method', [
  'citizen_confirmation',
  'field_inspection',
  'observation_data',
  'panel_review',
]);

export const resolutionVerdict = pgEnum('resolution_verdict', [
  'confirmed',
  'refuted',
  'inconclusive',
]);

export const reportResponses = pgTable(
  'report_responses',
  {
    id: uuidv7PrimaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    authorUserId: uuid('author_user_id'),
    kind: responseKind('kind').notNull().default('initial'),
    body: text('body').notNull(),
    evidenceUrls: emptyTextArray('evidence_urls'),
    correctsResponseId: uuid('corrects_response_id'),
    publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ix_responses_report').on(table.reportId, table.publishedAt),
    index('ix_responses_institution').on(table.institutionId, table.publishedAt),
    check('ck_response_body', sql`char_length(${table.body}) BETWEEN 20 AND 4000`),
  ],
);

export const resolutionVerifications = pgTable(
  'resolution_verifications',
  {
    id: uuidv7PrimaryKey(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    method: resolutionMethod('method').notNull(),
    verdict: resolutionVerdict('verdict').notNull(),
    verifierKind: verifierKind('verifier_kind').notNull(),
    verifierInstitutionId: uuid('verifier_institution_id').references(
      () => institutions.id,
      { onDelete: 'restrict' },
    ),
    verifierUserId: uuid('verifier_user_id'),
    claimantInstitutionId: uuid('claimant_institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    note: text('note'),
    evidenceUrls: emptyTextArray('evidence_urls'),
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('ix_resolution_report').on(table.reportId, table.verifiedAt),
    uniqueIndex('uq_resolution_verifier').on(
      table.reportId,
      table.verifierKind,
      sql`COALESCE(${table.verifierInstitutionId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`COALESCE(${table.verifierUserId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    check(
      'ck_resolution_independence',
      sql`${table.verifierInstitutionId} IS NULL OR ${table.verifierInstitutionId} <> ${table.claimantInstitutionId}`,
    ),
  ],
);

export const reportSla = pgTable('report_sla', {
  reportId: uuid('report_id')
    .primaryKey()
    .references(() => reports.id, { onDelete: 'cascade' }),
  policyVersion: text('policy_version').notNull(),
  priority: text('priority').notNull(),
  acknowledgeHours: numeric('acknowledge_hours', { precision: 6, scale: 2 }).notNull(),
  respondHours: numeric('respond_hours', { precision: 6, scale: 2 }).notNull(),
  resolveHours: numeric('resolve_hours', { precision: 6, scale: 2 }).notNull(),
  acknowledgeDue: timestamp('acknowledge_due', { withTimezone: true, mode: 'date' }).notNull(),
  respondDue: timestamp('respond_due', { withTimezone: true, mode: 'date' }).notNull(),
  resolveDue: timestamp('resolve_due', { withTimezone: true, mode: 'date' }).notNull(),
  frozenAt: timestamp('frozen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const partnerInvites = pgTable(
  'partner_invites',
  {
    id: uuidv7PrimaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    emailHash: text('email_hash').notNull(),
    emailEnc: bytea('email_enc').notNull(),
    role: text('role').notNull().default('responder'),
    tokenHash: bytea('token_hash').notNull(),
    invitedBy: uuid('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    index('ix_invite_expiry').on(table.expiresAt),
  ],
);
