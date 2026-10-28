import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, timestamps, uuidv7PrimaryKey } from './common';

export const platformAdminRole = pgEnum('platform_admin_role', ['moderator', 'superadmin']);

export const textArray = customType<{ data: string[]; driverData: string }>({
  dataType() {
    return 'text[]';
  },
});

export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: uuidv7PrimaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    role: platformAdminRole('role').notNull().default('moderator'),
    passwordHash: bytea('password_hash').notNull(),
    totpSecretEnc: bytea('totp_secret_enc').notNull(),
    totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastTotpStep: bigint('last_totp_step', { mode: 'number' }),
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (table) => [
    uniqueIndex('uq_platform_admins_email').on(table.email),
    index('ix_platform_admins_role')
      .on(table.role)
      .where(sql`${table.disabledAt} IS NULL`),
    check(
      'ck_platform_admins_email',
      sql`${table.email} = lower(${table.email}) AND char_length(${table.email}) BETWEEN 3 AND 254`,
    ),
    check(
      'ck_platform_admins_name',
      sql`char_length(${table.displayName}) BETWEEN 1 AND 120`,
    ),
    check(
      'ck_platform_admins_password',
      sql`octet_length(${table.passwordHash}) BETWEEN 16 AND 256`,
    ),
    check(
      'ck_platform_admins_totp',
      sql`octet_length(${table.totpSecretEnc}) BETWEEN 16 AND 512`,
    ),
  ],
);

export const platformAdminSessions = pgTable(
  'platform_admin_sessions',
  {
    id: uuidv7PrimaryKey(),
    adminId: uuid('admin_id')
      .notNull()
      .references(() => platformAdmins.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    ipHash: bytea('ip_hash'),
    userAgentHash: bytea('user_agent_hash'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
      mode: 'date',
    }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('uq_platform_admin_sessions_token').on(table.tokenHash),
    index('ix_platform_admin_sessions_admin').on(table.adminId, table.lastSeenAt.desc()),
    check('ck_platform_admin_sessions_token', sql`octet_length(${table.tokenHash}) = 32`),
    check(
      'ck_platform_admin_sessions_window',
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').$type<unknown>().notNull(),
    description: text('description'),
    updatedBy: uuid('updated_by').references(() => platformAdmins.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check('ck_feature_flags_key', sql`${table.key} ~ '^[a-z][a-z0-9_.-]{1,63}$'`),
  ],
);

export const rupPackages = pgTable(
  'rup_packages',
  {
    id: uuidv7PrimaryKey(),
    satker: text('satker').notNull(),
    name: text('name').notNull(),
    locationText: text('location_text'),
    fundingSource: text('funding_source'),
    pagu: numeric('pagu', { precision: 18, scale: 2 }),
    method: text('method'),
    fiscalYear: integer('fiscal_year').notNull(),
    status: text('status'),
    sourceUrl: text('source_url').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true, mode: 'date' }).notNull(),
    matchKeywords: textArray('match_keywords').notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_rup_packages').on(
      table.satker,
      table.name,
      table.fiscalYear,
      table.sourceUrl,
    ),
    index('ix_rup_year').on(table.fiscalYear, table.satker),
    check('ck_rup_packages_satker', sql`char_length(${table.satker}) BETWEEN 1 AND 160`),
    check('ck_rup_packages_name', sql`char_length(${table.name}) BETWEEN 1 AND 300`),
    check('ck_rup_packages_year', sql`${table.fiscalYear} BETWEEN 2000 AND 2100`),
    check('ck_rup_packages_pagu', sql`${table.pagu} IS NULL OR ${table.pagu} >= 0`),
    check(
      'ck_rup_packages_url',
      sql`char_length(${table.sourceUrl}) BETWEEN 1 AND 500`,
    ),
  ],
);

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type PlatformAdminSession = typeof platformAdminSessions.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type RupPackage = typeof rupPackages.$inferSelect;
