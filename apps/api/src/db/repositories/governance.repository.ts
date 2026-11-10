import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  AppealGrounds,
  AppealStatus,
  PanelRole,
  PanelStatus,
} from '@hadir/contracts';
import type { Database, Transaction } from '../client';

export interface PanelGrantRow {
  id: string;
  reportId: string;
  institutionId: string;
  institutionName: string;
  claimantInstitutionId: string;
  claimantInstitutionName: string;
  cityId: string;
  role: PanelRole;
  status: PanelStatus;
  createdAt: Date;
  decidedAt: Date | null;
  revokedAt: Date | null;
}

export interface PanelCandidateRow {
  institutionId: string;
  displayName: string;
  cityId: string | null;
  grantId: string | null;
  grantRole: PanelRole | null;
  grantStatus: PanelStatus | null;
  grantRevokedAt: Date | null;
}

export interface AppealRow {
  id: string;
  publicId: string;
  reportId: string;
  grounds: AppealGrounds;
  status: AppealStatus;
  statement: string;
  evidenceUrls: string[];
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  outcomeTransition: string | null;
  createdAt: Date;
  reportStatus: string;
  deviceHash: string;
}

export interface AppealCounts {
  reportsReceived: number;
  reportsAcknowledged: number;
  reportsResponded: number;
  slaTracked: number;
  slaMet: number;
  claimsResolved: number;
  claimsVerified: number;
  claimsDisputed: number;
  appealsDecided: number;
  appealsOverturned: number;
}

export interface InstitutionRow {
  id: string;
  name: string;
  cityId: string | null;
  cityName: string | null;
}

export interface CitySlaRow {
  cityId: string;
  cityName: string;
  priority: string;
  acknowledgeHours: number;
  respondHours: number;
  resolveHours: number;
  sourceUrl: string;
  note: string | null;
}

function text(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Kolom teks tidak valid.');
  }
  return value;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function date(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string') {
    return new Date(value);
  }
  throw new Error('Kolom waktu tidak valid.');
}

function nullableDate(value: unknown): Date | null {
  return value === null || value === undefined ? null : date(value);
}

function int(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function toPanelGrant(row: Record<string, unknown>): PanelGrantRow {
  return {
    id: text(row.id),
    reportId: text(row.report_id),
    institutionId: text(row.institution_id),
    institutionName: text(row.institution_name),
    claimantInstitutionId: text(row.claimant_institution_id),
    claimantInstitutionName: text(row.claimant_institution_name),
    cityId: text(row.city_id),
    role: text(row.role) as PanelRole,
    status: text(row.status) as PanelStatus,
    createdAt: date(row.created_at),
    decidedAt: nullableDate(row.decided_at),
    revokedAt: nullableDate(row.revoked_at),
  };
}

function toAppeal(row: Record<string, unknown>): AppealRow {
  return {
    id: text(row.id),
    publicId: text(row.public_id),
    reportId: text(row.report_id),
    grounds: text(row.grounds) as AppealGrounds,
    status: text(row.status) as AppealStatus,
    statement: text(row.statement),
    evidenceUrls: textArray(row.evidence_urls),
    decidedBy: nullableText(row.decided_by),
    decidedAt: nullableDate(row.decided_at),
    decisionNote: nullableText(row.decision_note),
    outcomeTransition: nullableText(row.outcome_transition),
    createdAt: date(row.created_at),
    reportStatus: text(row.report_status),
    deviceHash: text(row.device_hash),
  };
}

const APPEAL_SELECT = sql`
  a.id, r.public_id, a.report_id, a.grounds::text AS grounds,
  a.status::text AS status, a.statement, a.evidence_urls, a.decided_by,
  a.decided_at, a.decision_note, a.outcome_transition, a.created_at,
  r.status::text AS report_status, a.device_hash
`;

const PANEL_SELECT = sql`
  g.id, g.report_id, g.institution_id, i.name AS institution_name,
  g.claimant_institution_id, c.name AS claimant_institution_name,
  g.city_id, g.role::text AS role, g.status::text AS status,
  g.created_at, g.decided_at, g.revoked_at
`;

@Injectable()
export class GovernanceRepository {
  async findReportContext(
    executor: Database | Transaction,
    publicId: string,
  ): Promise<{
    id: string;
    publicId: string;
    status: string;
    cityId: string | null;
    institutionId: string | null;
    deviceHash: string;
    moderation: string;
    createdAt: Date;
  } | null> {
    const result = await executor.execute(sql`
      SELECT r.id, r.public_id, r.status::text AS status, r.city_id,
             r.institution_id, r.device_hash, r.moderation::text AS moderation,
             r.created_at
      FROM reports r
      WHERE r.public_id = ${publicId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: text(row.id),
      publicId: text(row.public_id),
      status: text(row.status),
      cityId: nullableText(row.city_id),
      institutionId: nullableText(row.institution_id),
      deviceHash: text(row.device_hash),
      moderation: text(row.moderation),
      createdAt: date(row.created_at),
    };
  }

  async findDecisionMoment(
    executor: Database | Transaction,
    reportId: string,
    fallback: Date,
  ): Promise<Date> {
    const result = await executor.execute(sql`
      SELECT max(e.created_at) AS decided_at
      FROM report_events e
      WHERE e.report_id = ${reportId}
        AND e.kind IN (
          'claimed_resolved', 'verified_resolved', 'disputed', 'rejected', 'corrected'
        )
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return nullableDate(row?.decided_at) ?? fallback;
  }

  async listPanelGrants(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<PanelGrantRow[]> {
    const result = await executor.execute(sql`
      SELECT ${PANEL_SELECT}
      FROM report_panel_grants g
      JOIN institutions i ON i.id = g.institution_id
      JOIN institutions c ON c.id = g.claimant_institution_id
      WHERE g.report_id = ${reportId}
      ORDER BY g.created_at ASC
    `);
    return result.rows.map((row) => toPanelGrant(row as Record<string, unknown>));
  }

  async listPanelCandidates(
    executor: Database | Transaction,
    reportId: string,
    cityId: string,
  ): Promise<PanelCandidateRow[]> {
    const result = await executor.execute(sql`
      SELECT i.id AS institution_id, i.name AS display_name, i.city_id,
             g.id AS grant_id, g.role::text AS grant_role,
             g.status::text AS grant_status, g.revoked_at AS grant_revoked_at
      FROM institutions i
      LEFT JOIN report_panel_grants g
        ON g.institution_id = i.id AND g.report_id = ${reportId}
      WHERE i.city_id = ${cityId}
      ORDER BY i.name
      LIMIT 100
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        institutionId: text(record.institution_id),
        displayName: text(record.display_name),
        cityId: nullableText(record.city_id),
        grantId: nullableText(record.grant_id),
        grantRole: nullableText(record.grant_role) as PanelRole | null,
        grantStatus: nullableText(record.grant_status) as PanelStatus | null,
        grantRevokedAt: nullableDate(record.grant_revoked_at),
      };
    });
  }

  async upsertPanelGrant(
    tx: Transaction,
    input: {
      reportId: string;
      institutionId: string;
      claimantInstitutionId: string;
      cityId: string;
      role: PanelRole;
      invitedBy: string;
    },
  ): Promise<string | null> {
    const existing = await tx.execute(sql`
      SELECT id, status::text AS status, revoked_at
      FROM report_panel_grants
      WHERE report_id = ${input.reportId} AND institution_id = ${input.institutionId}
      LIMIT 1
    `);
    const row = existing.rows[0] as Record<string, unknown> | undefined;

    if (row === undefined) {
      const inserted = await tx.execute(sql`
        INSERT INTO report_panel_grants (
          report_id, institution_id, claimant_institution_id, city_id, role,
          status, invited_by, decided_at
        ) VALUES (
          ${input.reportId}, ${input.institutionId}, ${input.claimantInstitutionId},
          ${input.cityId}, ${input.role}::panel_role, 'active', ${input.invitedBy}, now()
        )
        RETURNING id
      `);
      const created = inserted.rows[0] as Record<string, unknown> | undefined;
      return created === undefined ? null : text(created.id);
    }

    if (nullableText(row.revoked_at) !== null) {
      return null;
    }

    const updated = await tx.execute(sql`
      UPDATE report_panel_grants
      SET role = ${input.role}::panel_role, status = 'active', decided_at = now()
      WHERE id = ${text(row.id)} AND status <> 'active'
      RETURNING id
    `);
    const changed = updated.rows[0] as Record<string, unknown> | undefined;
    return changed === undefined ? text(row.id) : text(changed.id);
  }

  async revokePanelGrant(
    tx: Transaction,
    reportId: string,
    institutionId: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE report_panel_grants
      SET status = 'revoked', revoked_at = now()
      WHERE report_id = ${reportId}
        AND institution_id = ${institutionId}
        AND status <> 'revoked'
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async findActiveVerifier(
    executor: Database | Transaction,
    reportId: string,
    institutionId: string,
  ): Promise<boolean> {
    const result = await executor.execute(sql`
      SELECT 1 FROM report_panel_grants
      WHERE report_id = ${reportId}
        AND institution_id = ${institutionId}
        AND status = 'active'
        AND role = 'verifier'
      LIMIT 1
    `);
    return result.rows.length > 0;
  }

  async applyPanelVerdict(
    tx: Transaction,
    reportId: string,
    status: 'verified_resolved' | 'disputed',
    detail: {
      method: 'field_inspection' | 'panel_review';
      verdict: 'confirmed' | 'refuted' | 'inconclusive';
      note: string | null;
      evidenceUrls: readonly string[];
    },
  ): Promise<string> {
    const urls =
      detail.evidenceUrls.length === 0
        ? sql`'{}'::text[]`
        : sql.raw(
            `ARRAY[${detail.evidenceUrls
              .map((url) => `'${url.replace(/'/g, "''")}'`)
              .join(',')}]::text[]`,
          );
    const result = await tx.execute(sql`
      SELECT panel_apply_verdict(
        ${reportId}::uuid,
        ${status}::report_status,
        ${detail.method}::resolution_method,
        ${detail.verdict}::resolution_verdict,
        ${detail.note},
        ${urls}
      ) AS applied
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return nullableText(row?.applied) ?? status;
  }



  async listAppeals(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<AppealRow[]> {
    const result = await executor.execute(sql`
      SELECT ${APPEAL_SELECT}
      FROM report_appeals a
      JOIN reports r ON r.id = a.report_id
      WHERE a.report_id = ${reportId}
      ORDER BY a.created_at ASC
    `);
    return result.rows.map((row) => toAppeal(row as Record<string, unknown>));
  }

  async listAppealsForDevice(
    executor: Database | Transaction,
    deviceHash: string,
    limit: number,
  ): Promise<AppealRow[]> {
    const result = await executor.execute(sql`
      SELECT ${APPEAL_SELECT}
      FROM report_appeals a
      JOIN reports r ON r.id = a.report_id
      WHERE a.device_hash = ${deviceHash}
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => toAppeal(row as Record<string, unknown>));
  }

  async listAppealQueue(
    executor: Database | Transaction,
    mode: 'submitted' | 'admitted' | 'decided',
    limit: number,
  ): Promise<AppealRow[]> {
    const condition =
      mode === 'submitted'
        ? sql`a.status = 'submitted'`
        : mode === 'admitted'
          ? sql`a.status = 'admitted'`
          : sql`a.status IN ('upheld', 'overturned', 'inadmissible')`;
    const result = await executor.execute(sql`
      SELECT ${APPEAL_SELECT}
      FROM report_appeals a
      JOIN reports r ON r.id = a.report_id
      WHERE ${condition}
      ORDER BY a.created_at ASC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => toAppeal(row as Record<string, unknown>));
  }

  async countAppealsForReport(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<{ total: number; byGrounds: Record<string, number> }> {
    const result = await executor.execute(sql`
      SELECT grounds::text AS grounds, count(*)::int AS total
      FROM report_appeals
      WHERE report_id = ${reportId} AND status <> 'inadmissible'
      GROUP BY grounds
    `);
    const byGrounds: Record<string, number> = {};
    let total = 0;
    for (const row of result.rows as Record<string, unknown>[]) {
      const key = text(row.grounds);
      const value = int(row.total);
      byGrounds[key] = value;
      total += value;
    }
    return { total, byGrounds };
  }

  async insertAppeal(
    tx: Transaction,
    input: {
      reportId: string;
      deviceHash: string;
      grounds: AppealGrounds;
      statement: string;
      evidenceUrls: readonly string[];
    },
  ): Promise<string | null> {
    const urls =
      input.evidenceUrls.length === 0
        ? sql`'{}'::text[]`
        : sql.raw(
            `ARRAY[${input.evidenceUrls
              .map((url) => `'${url.replace(/'/g, "''")}'`)
              .join(',')}]::text[]`,
          );
    const result = await tx.execute(sql`
      INSERT INTO report_appeals (report_id, device_hash, grounds, statement, evidence_urls)
      VALUES (
        ${input.reportId}, ${input.deviceHash}, ${input.grounds}::appeal_grounds,
        ${input.statement}, ${urls}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : text(row.id);
  }

  async findAppeal(tx: Transaction, appealId: string): Promise<AppealRow | null> {
    const result = await tx.execute(sql`
      SELECT ${APPEAL_SELECT}
      FROM report_appeals a
      JOIN reports r ON r.id = a.report_id
      WHERE a.id = ${appealId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toAppeal(row);
  }

  async decideAppeal(
    tx: Transaction,
    input: {
      appealId: string;
      status: AppealStatus;
      adminId: string;
      note: string;
      transition: string;
    },
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE report_appeals
      SET status = ${input.status}::appeal_status,
          decided_by = ${input.adminId},
          decided_at = now(),
          decision_note = ${input.note},
          outcome_transition = ${input.transition}
      WHERE id = ${input.appealId} AND status IN ('submitted', 'admitted')
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async listInstitutions(
    executor: Database | Transaction,
    cityId: string | null,
  ): Promise<InstitutionRow[]> {
    const condition = cityId === null ? sql`true` : sql`i.city_id = ${cityId}`;
    const result = await executor.execute(sql`
      SELECT i.id, i.name, i.city_id, c.name AS city_name
      FROM institutions i
      LEFT JOIN cities c ON c.id = i.city_id
      WHERE ${condition}
      ORDER BY i.name
      LIMIT 200
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: text(record.id),
        name: text(record.name),
        cityId: nullableText(record.city_id),
        cityName: nullableText(record.city_name),
      };
    });
  }

  async findInstitution(
    executor: Database | Transaction,
    institutionId: string,
  ): Promise<InstitutionRow | null> {
    const result = await executor.execute(sql`
      SELECT i.id, i.name, i.city_id, c.name AS city_name
      FROM institutions i
      LEFT JOIN cities c ON c.id = i.city_id
      WHERE i.id = ${institutionId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      id: text(row.id),
      name: text(row.name),
      cityId: nullableText(row.city_id),
      cityName: nullableText(row.city_name),
    };
  }

  async scorecardCounts(
    executor: Database | Transaction,
    institutionId: string,
    windowDays: number,
  ): Promise<AppealCounts> {
    const result = await executor.execute(sql`
      SELECT
        count(*) FILTER (WHERE r.status <> 'draft')::int AS reports_received,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM report_events e
            WHERE e.report_id = r.id AND e.kind = 'acknowledged'
          )
        )::int AS reports_acknowledged,
        count(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM report_events e
            WHERE e.report_id = r.id AND e.kind = 'responded'
          )
        )::int AS reports_responded,
        count(s.report_id)::int AS sla_tracked,
        count(s.report_id) FILTER (
          WHERE NOT EXISTS (
            SELECT 1 FROM report_events e
            WHERE e.report_id = r.id
              AND e.kind = 'acknowledged'
              AND e.created_at > s.acknowledge_due
          )
        )::int AS sla_met,
        count(*) FILTER (WHERE r.status IN ('claimed_resolved', 'verified_resolved', 'disputed'))::int
          AS claims_resolved,
        count(*) FILTER (WHERE r.status = 'verified_resolved')::int AS claims_verified,
        count(*) FILTER (WHERE r.status = 'disputed')::int AS claims_disputed,
        (
          SELECT count(*)::int FROM report_appeals a
          JOIN reports ra ON ra.id = a.report_id
          WHERE ra.institution_id = ${institutionId}
            AND a.status IN ('upheld', 'overturned')
            AND a.created_at >= now() - (${windowDays}::text || ' days')::interval
        ) AS appeals_decided,
        (
          SELECT count(*)::int FROM report_appeals a
          JOIN reports ra ON ra.id = a.report_id
          WHERE ra.institution_id = ${institutionId}
            AND a.status = 'overturned'
            AND a.created_at >= now() - (${windowDays}::text || ' days')::interval
        ) AS appeals_overturned
      FROM reports r
      LEFT JOIN report_sla s ON s.report_id = r.id
      WHERE r.institution_id = ${institutionId}
        AND r.moderation = 'approved'
        AND r.created_at >= now() - (${windowDays}::text || ' days')::interval
    `);
    const row = (result.rows[0] ?? {}) as Record<string, unknown>;
    return {
      reportsReceived: int(row.reports_received),
      reportsAcknowledged: int(row.reports_acknowledged),
      reportsResponded: int(row.reports_responded),
      slaTracked: int(row.sla_tracked),
      slaMet: int(row.sla_met),
      claimsResolved: int(row.claims_resolved),
      claimsVerified: int(row.claims_verified),
      claimsDisputed: int(row.claims_disputed),
      appealsDecided: int(row.appeals_decided),
      appealsOverturned: int(row.appeals_overturned),
    };
  }

  async listCitySlaOverrides(
    executor: Database | Transaction,
    cityId: string,
  ): Promise<CitySlaRow[]> {
    const result = await executor.execute(sql`
      SELECT o.city_id, c.name AS city_name, o.priority,
             o.acknowledge_hours::float8 AS acknowledge_hours,
             o.respond_hours::float8 AS respond_hours,
             o.resolve_hours::float8 AS resolve_hours,
             o.source_url, o.note
      FROM city_sla_overrides o
      JOIN cities c ON c.id = o.city_id
      WHERE o.city_id = ${cityId}
      ORDER BY CASE o.priority
        WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        cityId: text(record.city_id),
        cityName: text(record.city_name),
        priority: text(record.priority),
        acknowledgeHours: num(record.acknowledge_hours),
        respondHours: num(record.respond_hours),
        resolveHours: num(record.resolve_hours),
        sourceUrl: text(record.source_url),
        note: nullableText(record.note),
      };
    });
  }

  async upsertCitySlaOverride(
    tx: Transaction,
    input: {
      cityId: string;
      priority: string;
      acknowledgeHours: number;
      respondHours: number;
      resolveHours: number;
      sourceUrl: string;
      note: string | null;
    },
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      INSERT INTO city_sla_overrides (
        city_id, priority, acknowledge_hours, respond_hours, resolve_hours,
        source_url, note
      ) VALUES (
        ${input.cityId}, ${input.priority}, ${input.acknowledgeHours},
        ${input.respondHours}, ${input.resolveHours}, ${input.sourceUrl},
        ${input.note}
      )
      ON CONFLICT (city_id, priority) DO UPDATE
      SET acknowledge_hours = EXCLUDED.acknowledge_hours,
          respond_hours = EXCLUDED.respond_hours,
          resolve_hours = EXCLUDED.resolve_hours,
          source_url = EXCLUDED.source_url,
          note = EXCLUDED.note
      RETURNING city_id
    `);
    return result.rows.length > 0;
  }

  async panelReportsForInstitution(
    executor: Database | Transaction,
    institutionId: string,
    limit: number,
  ): Promise<
    { publicId: string; status: string; category: string; claimantName: string; role: string }[]
  > {
    const result = await executor.execute(sql`
      SELECT r.public_id, r.status::text AS status, r.category::text AS category,
             i.name AS claimant_name, g.role::text AS role
      FROM report_panel_grants g
      JOIN reports r ON r.id = g.report_id
      JOIN institutions i ON i.id = g.claimant_institution_id
      WHERE g.institution_id = ${institutionId} AND g.status = 'active'
      ORDER BY r.created_at DESC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        publicId: text(record.public_id),
        status: text(record.status),
        category: text(record.category),
        claimantName: text(record.claimant_name),
        role: text(record.role),
      };
    });
  }
}
