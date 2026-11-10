import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ResolutionMethod,
  ResolutionVerdict,
  ResponseKind,
  VerifierKind,
} from '@hadir/contracts';
import type { Database, Transaction } from '../client';

export interface ReportCaseRow {
  id: string;
  publicId: string;
  status: string;
  category: string;
  institutionId: string | null;
  institutionName: string | null;
  deviceHash: string;
  createdAt: Date;
}

export interface ResponseRow {
  id: string;
  kind: ResponseKind;
  body: string;
  evidenceUrls: string[];
  institutionId: string;
  institutionName: string;
  authorDisplayName: string | null;
  correctsResponseId: string | null;
  publishedAt: Date;
}

export interface VerificationRow {
  id: string;
  method: ResolutionMethod;
  verdict: ResolutionVerdict;
  verifierKind: VerifierKind;
  verifierInstitutionId: string | null;
  verifierUserId: string | null;
  verifierLabel: string;
  note: string | null;
  evidenceUrls: string[];
  verifiedAt: Date;
}

export interface SlaRow {
  reportId: string;
  policyVersion: string;
  priority: string;
  acknowledgeHours: number;
  respondHours: number;
  resolveHours: number;
  acknowledgeDue: Date;
  respondDue: Date;
  resolveDue: Date;
}

export interface EventRow {
  seq: number;
  kind: string;
  actorType: string;
  actorId: string | null;
  createdAt: Date;
}

export interface MemberRow {
  membershipId: string;
  userId: string;
  displayName: string;
  role: string;
  status: string;
  createdAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

export interface ClosureRow {
  id: string;
  answer: string;
  note: string | null;
  mediaId: string | null;
  createdAt: Date;
}

export interface InviteRow {
  id: string;
  emailEnc: Buffer;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export interface SlaBreachRow {
  publicId: string;
  category: string;
  status: string;
  institutionName: string | null;
  priority: string;
  acknowledgeDue: Date;
  respondDue: Date;
  resolveDue: Date;
  acknowledgedAt: Date | null;
  respondedAt: Date | null;
  resolvedAt: Date | null;
}

export interface AttestationInsert {
  bodyDigest: Buffer;
  signature: Buffer;
  algorithm: string;
  keyId: string;
  publicKey: Buffer;
  signedAt: Date;
}

export interface ResponseInsert {
  reportId: string;
  institutionId: string;
  authorUserId: string;
  kind: ResponseKind;
  body: string;
  evidenceUrls: readonly string[];
  correctsResponseId: string | null;
  publishedAt: Date;
  attestation: AttestationInsert | null;
}



export interface VerificationInsert {
  reportId: string;
  method: ResolutionMethod;
  verdict: ResolutionVerdict;
  verifierKind: VerifierKind;
  verifierInstitutionId: string | null;
  verifierUserId: string | null;
  claimantInstitutionId: string;
  note: string | null;
  evidenceUrls: readonly string[];
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

function number(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function toCase(row: Record<string, unknown>): ReportCaseRow {
  return {
    id: text(row.id),
    publicId: text(row.public_id),
    status: text(row.status),
    category: text(row.category),
    institutionId: nullableText(row.institution_id),
    institutionName: nullableText(row.institution_name),
    deviceHash: text(row.device_hash),
    createdAt: date(row.created_at),
  };
}

function toResponse(row: Record<string, unknown>): ResponseRow {
  return {
    id: text(row.id),
    kind: text(row.kind) as ResponseKind,
    body: text(row.body),
    evidenceUrls: textArray(row.evidence_urls),
    institutionId: text(row.institution_id),
    institutionName: text(row.institution_name),
    authorDisplayName: nullableText(row.author_display_name),
    correctsResponseId: nullableText(row.corrects_response_id),
    publishedAt: date(row.published_at),
  };
}

function toVerification(row: Record<string, unknown>): VerificationRow {
  return {
    id: text(row.id),
    method: text(row.method) as ResolutionMethod,
    verdict: text(row.verdict) as ResolutionVerdict,
    verifierKind: text(row.verifier_kind) as VerifierKind,
    verifierInstitutionId: nullableText(row.verifier_institution_id),
    verifierUserId: nullableText(row.verifier_user_id),
    verifierLabel: text(row.verifier_label),
    note: nullableText(row.note),
    evidenceUrls: textArray(row.evidence_urls),
    verifiedAt: date(row.verified_at),
  };
}

function toEvent(row: Record<string, unknown>): EventRow {
  return {
    seq: number(row.seq),
    kind: text(row.kind),
    actorType: text(row.actor_type),
    actorId: nullableText(row.actor_id),
    createdAt: date(row.created_at),
  };
}

function toMember(row: Record<string, unknown>): MemberRow {
  return {
    membershipId: text(row.membership_id),
    userId: text(row.user_id),
    displayName: text(row.display_name),
    role: text(row.role),
    status: text(row.status),
    createdAt: date(row.created_at),
    revokedAt: nullableDate(row.revoked_at),
    lastSeenAt: nullableDate(row.last_seen_at),
  };
}

function toInvite(row: Record<string, unknown>): InviteRow {
  return {
    id: text(row.id),
    emailEnc: row.email_enc instanceof Buffer ? row.email_enc : Buffer.alloc(0),
    role: text(row.role),
    createdAt: date(row.created_at),
    expiresAt: date(row.expires_at),
    consumedAt: nullableDate(row.consumed_at),
    revokedAt: nullableDate(row.revoked_at),
  };
}

function toBreach(row: Record<string, unknown>): SlaBreachRow {
  return {
    publicId: text(row.public_id),
    category: text(row.category),
    status: text(row.status),
    institutionName: nullableText(row.institution_name),
    priority: text(row.priority),
    acknowledgeDue: date(row.acknowledge_due),
    respondDue: date(row.respond_due),
    resolveDue: date(row.resolve_due),
    acknowledgedAt: nullableDate(row.acknowledged_at),
    respondedAt: nullableDate(row.responded_at),
    resolvedAt: nullableDate(row.resolved_at),
  };
}

const RESPONSE_SELECT = sql`
  rp.id, rp.kind::text AS kind, rp.body, rp.evidence_urls,
  rp.institution_id, i.name AS institution_name,
  u.display_name AS author_display_name,
  rp.corrects_response_id, rp.published_at
`;

const VERIFICATION_SELECT = sql`
  rv.id, rv.method::text AS method, rv.verdict::text AS verdict,
  rv.verifier_kind::text AS verifier_kind, rv.verifier_institution_id,
  rv.verifier_user_id, rv.note, rv.evidence_urls, rv.verified_at,
  CASE
    WHEN rv.verifier_kind = 'citizen' THEN 'Warga pelapor'
    WHEN rv.verifier_kind = 'platform' THEN 'Platform HADIR'
    WHEN rv.verifier_kind = 'automatic' THEN 'Pemeriksaan otomatis'
    ELSE COALESCE(vi.name, 'Institusi independen')
  END AS verifier_label
`;

@Injectable()
export class AccountabilityRepository {
  async findCase(
    executor: Database | Transaction,
    publicId: string,
  ): Promise<ReportCaseRow | null> {
    const result = await executor.execute(sql`
      SELECT r.id, r.public_id, r.status::text AS status, r.category::text AS category,
             r.institution_id, i.name AS institution_name, r.device_hash, r.created_at
      FROM reports r
      LEFT JOIN institutions i ON i.id = r.institution_id
      WHERE r.public_id = ${publicId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toCase(row);
  }

  async lockCase(
    tx: Transaction,
    publicId: string,
  ): Promise<ReportCaseRow | null> {
    const result = await tx.execute(sql`
      SELECT r.id, r.public_id, r.status::text AS status, r.category::text AS category,
             r.institution_id, i.name AS institution_name, r.device_hash, r.created_at
      FROM reports r
      LEFT JOIN institutions i ON i.id = r.institution_id
      WHERE r.public_id = ${publicId}
      FOR UPDATE OF r
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toCase(row);
  }

  async listEvents(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<EventRow[]> {
    const result = await executor.execute(sql`
      SELECT seq, kind::text AS kind, actor_type::text AS actor_type,
             actor_id, created_at
      FROM report_events
      WHERE report_id = ${reportId}
      ORDER BY seq ASC
    `);
    return result.rows.map((row) => toEvent(row as Record<string, unknown>));
  }

  async listResponses(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<ResponseRow[]> {
    const result = await executor.execute(sql`
      SELECT ${RESPONSE_SELECT}
      FROM report_responses rp
      JOIN institutions i ON i.id = rp.institution_id
      LEFT JOIN partner_users u ON u.id = rp.author_user_id
      WHERE rp.report_id = ${reportId}
      ORDER BY rp.published_at ASC
      LIMIT 50
    `);
    return result.rows.map((row) => toResponse(row as Record<string, unknown>));
  }

  async insertResponse(
    tx: Transaction,
    input: ResponseInsert,
  ): Promise<string> {
    const urls = input.evidenceUrls.length === 0
      ? sql`'{}'::text[]`
      : sql`${sql.raw(
          `ARRAY[${input.evidenceUrls
            .map((url) => `'${url.replace(/'/g, "''")}'`)
            .join(',')}]::text[]`,
        )}`;
    const result = await tx.execute(sql`
      INSERT INTO report_responses (
        report_id, institution_id, author_user_id, kind, body,
        evidence_urls, corrects_response_id, published_at,
        body_digest, signature, signature_algorithm, signing_key_id,
        public_key, signed_at
      ) VALUES (
        ${input.reportId}, ${input.institutionId}, ${input.authorUserId},
        ${input.kind}::response_kind, ${input.body}, ${urls},
        ${input.correctsResponseId}, ${input.publishedAt},
        ${input.attestation?.bodyDigest ?? null},
        ${input.attestation?.signature ?? null},
        ${input.attestation?.algorithm ?? null},
        ${input.attestation?.keyId ?? null},
        ${input.attestation?.publicKey ?? null},
        ${input.attestation?.signedAt ?? null}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Tanggapan instansi gagal disimpan.');
    }
    return text(row.id);
  }

  async listClosureAnswers(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<ClosureRow[]> {
    const result = await executor.execute(sql`
      SELECT id, answer::text AS answer, note, media_id, created_at
      FROM closure_verifications
      WHERE report_id = ${reportId}
      ORDER BY created_at ASC
      LIMIT 50
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        id: text(record.id),
        answer: text(record.answer),
        note: nullableText(record.note),
        mediaId: nullableText(record.media_id),
        createdAt: date(record.created_at),
      };
    });
  }

  async listAttestations(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<
    {
      responseId: string;
      bodyDigestHex: string | null;
      signatureBase64: string | null;
      signatureAlgorithm: string | null;
      signingKeyId: string | null;
      publicKeyBase64: string | null;
      signedAt: Date | null;
    }[]
  > {
    const result = await executor.execute(sql`
      SELECT response_id, body_digest_hex, signature_base64, signature_algorithm,
             signing_key_id, public_key_base64, signed_at
      FROM response_attestations
      WHERE report_id = ${reportId}
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        responseId: text(record.response_id),
        bodyDigestHex: nullableText(record.body_digest_hex),
        signatureBase64: nullableText(record.signature_base64),
        signatureAlgorithm: nullableText(record.signature_algorithm),
        signingKeyId: nullableText(record.signing_key_id),
        publicKeyBase64: nullableText(record.public_key_base64),
        signedAt: nullableDate(record.signed_at),
      };
    });
  }

  async listVerifications(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<VerificationRow[]> {
    const result = await executor.execute(sql`
      SELECT ${VERIFICATION_SELECT}
      FROM resolution_verifications rv
      LEFT JOIN institutions vi ON vi.id = rv.verifier_institution_id
      WHERE rv.report_id = ${reportId}
      ORDER BY rv.verified_at ASC
      LIMIT 50
    `);
    return result.rows.map((row) => toVerification(row as Record<string, unknown>));
  }

  async insertVerification(
    tx: Transaction,
    input: VerificationInsert,
  ): Promise<string> {
    const urls = input.evidenceUrls.length === 0
      ? sql`'{}'::text[]`
      : sql`${sql.raw(
          `ARRAY[${input.evidenceUrls
            .map((url) => `'${url.replace(/'/g, "''")}'`)
            .join(',')}]::text[]`,
        )}`;
    const result = await tx.execute(sql`
      INSERT INTO resolution_verifications (
        report_id, method, verdict, verifier_kind, verifier_institution_id,
        verifier_user_id, claimant_institution_id, note, evidence_urls
      ) VALUES (
        ${input.reportId}, ${input.method}::resolution_method,
        ${input.verdict}::resolution_verdict,
        ${input.verifierKind}::verifier_kind, ${input.verifierInstitutionId},
        ${input.verifierUserId}, ${input.claimantInstitutionId}, ${input.note},
        ${urls}
      )
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      throw new Error('Verifikasi penyelesaian gagal disimpan.');
    }
    return text(row.id);
  }

  async freezeSla(
    tx: Transaction,
    input: {
      reportId: string;
      policyVersion: string;
      priority: string;
      acknowledgeHours: number;
      respondHours: number;
      resolveHours: number;
      acknowledgeDue: Date;
      respondDue: Date;
      resolveDue: Date;
    },
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      INSERT INTO report_sla (
        report_id, policy_version, priority, acknowledge_hours, respond_hours,
        resolve_hours, acknowledge_due, respond_due, resolve_due
      ) VALUES (
        ${input.reportId}, ${input.policyVersion}, ${input.priority},
        ${input.acknowledgeHours}, ${input.respondHours}, ${input.resolveHours},
        ${input.acknowledgeDue}, ${input.respondDue}, ${input.resolveDue}
      )
      ON CONFLICT (report_id) DO NOTHING
      RETURNING report_id
    `);
    return result.rows.length > 0;
  }

  async findSla(
    executor: Database | Transaction,
    reportId: string,
  ): Promise<SlaRow | null> {
    const result = await executor.execute(sql`
      SELECT report_id, policy_version, priority,
             acknowledge_hours::float8 AS acknowledge_hours,
             respond_hours::float8 AS respond_hours,
             resolve_hours::float8 AS resolve_hours,
             acknowledge_due, respond_due, resolve_due
      FROM report_sla
      WHERE report_id = ${reportId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row === undefined) {
      return null;
    }
    return {
      reportId: text(row.report_id),
      policyVersion: text(row.policy_version),
      priority: text(row.priority),
      acknowledgeHours: number(row.acknowledge_hours),
      respondHours: number(row.respond_hours),
      resolveHours: number(row.resolve_hours),
      acknowledgeDue: date(row.acknowledge_due),
      respondDue: date(row.respond_due),
      resolveDue: date(row.resolve_due),
    };
  }

  async listMembers(
    executor: Database | Transaction,
    institutionId: string,
  ): Promise<MemberRow[]> {
    const result = await executor.execute(sql`
      SELECT m.id AS membership_id, m.user_id, u.display_name, m.role::text AS role,
             u.status::text AS status, m.created_at, m.revoked_at,
             (SELECT max(s.last_seen_at) FROM partner_sessions s
               WHERE s.user_id = m.user_id AND s.revoked_at IS NULL) AS last_seen_at
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      WHERE m.institution_id = ${institutionId}
      ORDER BY m.revoked_at NULLS FIRST, u.display_name
    `);
    return result.rows.map((row) => toMember(row as Record<string, unknown>));
  }

  async findMembership(
    tx: Transaction,
    institutionId: string,
    membershipId: string,
  ): Promise<MemberRow | null> {
    const result = await tx.execute(sql`
      SELECT m.id AS membership_id, m.user_id, u.display_name, m.role::text AS role,
             u.status::text AS status, m.created_at, m.revoked_at, NULL::timestamptz AS last_seen_at
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      WHERE m.institution_id = ${institutionId} AND m.id = ${membershipId}
      FOR UPDATE OF m
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toMember(row);
  }

  async findMembershipByUser(
    tx: Transaction,
    institutionId: string,
    userId: string,
  ): Promise<MemberRow | null> {
    const result = await tx.execute(sql`
      SELECT m.id AS membership_id, m.user_id, u.display_name, m.role::text AS role,
             u.status::text AS status, m.created_at, m.revoked_at, NULL::timestamptz AS last_seen_at
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      WHERE m.institution_id = ${institutionId} AND m.user_id = ${userId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : toMember(row);
  }

  async updateMembershipRole(
    tx: Transaction,
    membershipId: string,
    role: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE partner_memberships
      SET role = ${role}::partner_role
      WHERE id = ${membershipId} AND revoked_at IS NULL
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async revokeMembership(
    tx: Transaction,
    membershipId: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE partner_memberships
      SET revoked_at = now()
      WHERE id = ${membershipId} AND revoked_at IS NULL
      RETURNING user_id
    `);
    return result.rows.length > 0;
  }

  async revokeSessionsForUser(
    tx: Transaction,
    userId: string,
  ): Promise<number> {
    const result = await tx.execute(sql`
      UPDATE partner_sessions
      SET revoked_at = now()
      WHERE user_id = ${userId} AND revoked_at IS NULL
      RETURNING id
    `);
    return result.rows.length;
  }

  async countActiveAdmins(
    executor: Database | Transaction,
    institutionId: string,
  ): Promise<number> {
    const result = await executor.execute(sql`
      SELECT count(*)::int AS total
      FROM partner_memberships m
      JOIN partner_users u ON u.id = m.user_id
      WHERE m.institution_id = ${institutionId}
        AND m.role = 'admin'
        AND m.revoked_at IS NULL
        AND u.status = 'active'
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return number(row?.total);
  }

  async createInvite(
    tx: Transaction,
    input: {
      institutionId: string;
      emailHash: string;
      emailEnc: Buffer;
      role: string;
      tokenHash: Buffer;
      invitedBy: string;
      expiresAt: Date;
    },
  ): Promise<{ id: string } | null> {
    const result = await tx.execute(sql`
      INSERT INTO partner_invites (
        institution_id, email_hash, email_enc, role, token_hash, invited_by, expires_at
      ) VALUES (
        ${input.institutionId}, ${input.emailHash}, ${input.emailEnc},
        ${input.role}::partner_role, ${input.tokenHash}, ${input.invitedBy},
        ${input.expiresAt}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : { id: text(row.id) };
  }

  async listInvites(
    executor: Database | Transaction,
    institutionId: string,
  ): Promise<InviteRow[]> {
    const result = await executor.execute(sql`
      SELECT id, email_enc, role::text AS role, created_at, expires_at,
             consumed_at, revoked_at
      FROM partner_invites
      WHERE institution_id = ${institutionId}
      ORDER BY created_at DESC
      LIMIT 100
    `);
    return result.rows.map((row) => toInvite(row as Record<string, unknown>));
  }

  async revokeInvite(
    tx: Transaction,
    institutionId: string,
    inviteId: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE partner_invites
      SET revoked_at = now()
      WHERE id = ${inviteId} AND institution_id = ${institutionId}
        AND consumed_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async consumeInvite(
    tx: Transaction,
    inviteId: string,
  ): Promise<boolean> {
    const result = await tx.execute(sql`
      UPDATE partner_invites
      SET consumed_at = now()
      WHERE id = ${inviteId} AND consumed_at IS NULL AND revoked_at IS NULL
        AND expires_at > now()
      RETURNING id
    `);
    return result.rows.length > 0;
  }

  async listBreaches(
    executor: Database | Transaction,
    limit: number,
  ): Promise<SlaBreachRow[]> {
    const result = await executor.execute(sql`
      SELECT r.public_id, r.category::text AS category, r.status::text AS status,
             i.name AS institution_name, s.priority,
             s.acknowledge_due, s.respond_due, s.resolve_due,
             (SELECT min(e.created_at) FROM report_events e
               WHERE e.report_id = r.id AND e.kind = 'acknowledged') AS acknowledged_at,
             (SELECT min(e.created_at) FROM report_events e
               WHERE e.report_id = r.id AND e.kind = 'responded') AS responded_at,
             (SELECT min(e.created_at) FROM report_events e
               WHERE e.report_id = r.id AND e.kind = 'verified_resolved') AS resolved_at
      FROM report_sla s
      JOIN reports r ON r.id = s.report_id
      LEFT JOIN institutions i ON i.id = r.institution_id
      WHERE r.status NOT IN ('verified_resolved', 'rejected', 'closed')
        AND (
          s.acknowledge_due < now()
          OR s.respond_due < now()
          OR s.resolve_due < now()
        )
      ORDER BY s.resolve_due ASC
      LIMIT ${limit}
    `);
    return result.rows.map((row) => toBreach(row as Record<string, unknown>));
  }
}
