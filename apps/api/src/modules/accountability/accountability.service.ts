import { Inject, Injectable } from '@nestjs/common';
import {
  ATTESTATION_ALGORITHM,
  attestationCaveats,
  attestationIsSigned,
  attestationPayloadFrom,
  canonicalResponsePayload,
  decideResolution,
  describeSlaPhase,
  milestoneCaveats,
  milestoneCompletionByEvents,
  milestoneGaps,
  milestoneLabel,
  isTerminalMilestone,
  resolutionCautions,
  resolutionCaveats,
  resolutionConflicts,
  slaCaveats,
  slaEscalationLine,
  slaReport,
  signingKeyFingerprint,
  verifyResponseAttestation,
  type AttestationEnvelope,
  type MilestoneEvent as DomainMilestoneEvent,
  type ResolutionClaim,
  type ResolutionVerification as DomainVerification,
  type ReportEventKind as DomainEventKind,
  type SlaMilestones,
  type SlaPriority,
} from '@hadir/domain';
import type {
  CaseFile,
  ReportResponse,
  ResponseAttestation as ResponseAttestationView,
  ResponseAttestationDocument,
  ResolutionVerifyInput,
  ResolutionVerifyResult,
  ResponseCreate,
  SlaBreachItem,
  SlaView,
} from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../common/audit/audit.service';
import { env } from '../../common/config/env';
import {
  createResponseSigner,
  verifyResponseSignature,
} from '../../common/crypto/response-signer';
import { createHash } from 'node:crypto';
import type { PartnerSession } from '../../common/auth/partner-session';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import { db } from '../../db/client';
import {
  AccountabilityRepository,
  type ClosureRow,
  type EventRow,
  type ReportCaseRow,
  type SlaRow,
  type VerificationRow,
} from '../../db/repositories/accountability.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';

const HOUR_MS = 3_600_000;

function responseSigner(): ReturnType<typeof createResponseSigner> | null {
  if (env.responseSigningKey === null || env.responseSigningKeyId === null) {
    return null;
  }
  return createResponseSigner({
    privateKey: env.responseSigningKey,
    keyId: env.responseSigningKeyId,
  });
}

function sha256Hex(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}
const SLA_PHASES = ['acknowledge', 'respond', 'resolve'] as const;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toSlaView(row: SlaRow, milestones: SlaMilestones, now: string): SlaView {
  const report = slaReport(milestones, row.priority as SlaPriority, now);
  return {
    policyVersion: row.policyVersion,
    priority: row.priority as SlaPriority,
    targets: {
      acknowledgeHours: row.acknowledgeHours,
      respondHours: row.respondHours,
      resolveHours: row.resolveHours,
    },
    phases: report.phases.map((phase) => ({
      phase: phase.phase,
      dueAt: phase.dueAt,
      metAt: phase.metAt,
      state: phase.state,
      lateByHours: phase.lateByHours,
      remainingHours: phase.remainingHours,
    })),
    breached: report.breached,
    escalation: report.escalation,
    summary: slaEscalationLine(report),
  };
}

function toDomainEvent(row: EventRow): DomainMilestoneEvent {
  return {
    seq: row.seq,
    kind: row.kind as DomainEventKind,
    actorType: row.actorType,
    actorId: row.actorId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toDomainVerification(row: VerificationRow): DomainVerification {
  return {
    id: row.id,
    method: row.method,
    verdict: row.verdict,
    verifierKind: row.verifierKind,
    verifierInstitutionId: row.verifierInstitutionId,
    verifierUserId: row.verifierUserId,
    note: row.note,
    evidenceUrls: row.evidenceUrls,
    verifiedAt: row.verifiedAt.toISOString(),
  };
}

function verifierLabelOf(
  verification: DomainVerification,
  labels: ReadonlyMap<string, string>,
): string {
  const known = labels.get(verification.id);
  if (known !== undefined) {
    return known;
  }
  if (verification.verifierKind === 'citizen') {
    return 'Warga pelapor';
  }
  if (verification.verifierKind === 'platform') {
    return 'Platform HADIR';
  }
  if (verification.verifierKind === 'automatic') {
    return 'Pemeriksaan otomatis';
  }
  return 'Institusi independen';
}

function attestationView(
  input: {
    body: string;
    reportPublicId: string;
    institutionId: string;
    kind: string;
    evidenceUrls: readonly string[];
    publishedAt: Date;
    correctsResponseId: string | null;
    bodyDigestHex: string | null;
    signatureBase64: string | null;
    signatureAlgorithm: string | null;
    signingKeyId: string | null;
    publicKeyBase64: string | null;
    signedAt: Date | null;
  },
): ResponseAttestationView {
  const envelope: AttestationEnvelope = {
    reportPublicId: input.reportPublicId,
    institutionId: input.institutionId,
    kind: input.kind,
    bodyDigestHex: input.bodyDigestHex ?? '',
    evidenceUrls: [...input.evidenceUrls],
    publishedAt: input.publishedAt.toISOString(),
    correctsResponseId: input.correctsResponseId,
    signatureBase64: input.signatureBase64,
    signatureAlgorithm: input.signatureAlgorithm,
    signingKeyId: input.signingKeyId,
    publicKeyBase64: input.publicKeyBase64,
    signedAt: input.signedAt === null ? null : input.signedAt.toISOString(),
  };
  const verification = verifyResponseAttestation(envelope, (payload, signature, key) =>
    verifyResponseSignature({ payload, publicKeyBase64: key, signatureBase64: signature }),
  );
  return {
    signed: verification.signed,
    status: verification.status,
    bodyDigest: input.bodyDigestHex,
    signingKeyId: input.signingKeyId,
    keyFingerprint: signingKeyFingerprint(input.publicKeyBase64),
    algorithm: input.signatureAlgorithm,
    signedAt: input.signedAt === null ? null : input.signedAt.toISOString(),
    message: verification.message,
  };
}

function closureToVerification(row: ClosureRow): DomainVerification {
  const verdict =
    row.answer === 'yes' ? 'confirmed' : row.answer === 'no' ? 'refuted' : 'inconclusive';
  return {
    id: row.id,
    method: 'citizen_confirmation',
    verdict,
    verifierKind: 'citizen',
    verifierInstitutionId: null,
    verifierUserId: null,
    note: row.note,
    evidenceUrls:
      row.mediaId === null ? [] : [`urn:hadir:media:${row.mediaId}`],
    verifiedAt: row.createdAt.toISOString(),
  };
}

function slaMilestonesOf(events: readonly EventRow[]): SlaMilestones {
  const first = (kind: string): string | null => {
    const found = events.find((event) => event.kind === kind);
    return found === undefined ? null : found.createdAt.toISOString();
  };
  return {
    submittedAt:
      first('submitted') ?? (events[0]?.createdAt.toISOString() ?? new Date(0).toISOString()),
    acknowledgedAt: first('acknowledged'),
    respondedAt: first('responded'),
    resolvedAt: first('verified_resolved'),
  };
}

function worstPhase(row: SlaRow, now: Date): {
  phase: (typeof SLA_PHASES)[number];
  dueAt: Date;
  hoursLate: number;
} | null {
  const table: readonly { phase: (typeof SLA_PHASES)[number]; dueAt: Date }[] = [
    { phase: 'acknowledge', dueAt: row.acknowledgeDue },
    { phase: 'respond', dueAt: row.respondDue },
    { phase: 'resolve', dueAt: row.resolveDue },
  ];
  let worst: { phase: (typeof SLA_PHASES)[number]; dueAt: Date; hoursLate: number } | null =
    null;
  for (const entry of table) {
    const hoursLate = (now.getTime() - entry.dueAt.getTime()) / HOUR_MS;
    if (hoursLate <= 0) {
      continue;
    }
    if (worst === null || hoursLate > worst.hoursLate) {
      worst = { ...entry, hoursLate: Math.round(hoursLate * 10) / 10 };
    }
  }
  return worst;
}

function escalationsOf(row: SlaRow, now: Date): number {
  let late = 0;
  if (row.acknowledgeDue.getTime() < now.getTime()) {
    late += 1;
  }
  if (row.respondDue.getTime() < now.getTime()) {
    late += 1;
  }
  if (row.resolveDue.getTime() < now.getTime()) {
    late += 1;
  }
  return Math.min(3, late === 0 ? 0 : Math.min(3, late + 1));
}

@Injectable()
export class AccountabilityService {
  constructor(
    private readonly repository: AccountabilityRepository,
    private readonly reports: ReportsRepository,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private claimOf(caseRow: ReportCaseRow): ResolutionClaim {
    return {
      publicId: caseRow.publicId,
      claimantInstitutionId: caseRow.institutionId ?? '00000000-0000-0000-0000-000000000000',
      claimedAt: caseRow.createdAt.toISOString(),
    };
  }

  private buildCaseFile(
    caseRow: ReportCaseRow,
    events: readonly EventRow[],
    responses: readonly ReportResponse[],
    verifications: readonly VerificationRow[],
    closures: readonly ClosureRow[],
    sla: SlaRow | null,
    now: string,
  ): CaseFile {
    const domainEvents = events.map(toDomainEvent);
    const tracker = milestoneCompletionByEvents(domainEvents);
    const labels = new Map(
      verifications.map((verification) => [verification.id, verification.verifierLabel]),
    );
    const domainVerifications = [
      ...verifications.map(toDomainVerification),
      ...closures.map(closureToVerification),
    ];
    const claim = this.claimOf(caseRow);
    const decision = decideResolution(claim, domainVerifications);

    return {
      publicId: caseRow.publicId,
      status: caseRow.status,
      category: caseRow.category,
      createdAt: caseRow.createdAt.toISOString(),
      milestones: {
        entries: tracker.entries.map((entry) => ({
          key: entry.key,
          at: entry.at,
          actorType: entry.actorType as 'citizen' | 'partner' | 'admin' | 'system',
          label: milestoneLabel(entry.key),
          terminal: isTerminalMilestone(entry.key),
        })),
        current: tracker.current,
        next: tracker.next,
        progress: tracker.progress,
        terminal: tracker.terminal,
        pendingInfoRequest: tracker.pendingInfoRequest,
        gaps: [...milestoneGaps(tracker)],
        caveats: [...milestoneCaveats()].slice(0, 4),
      },
      sla: sla === null ? null : toSlaView(sla, slaMilestonesOf(events), now),
      responses: responses.slice(0, 20).map((response) => ({ ...response })),
      verifications: domainVerifications.slice(0, 20).map((verification) => ({
        id: verification.id,
        method: verification.method,
        verdict: verification.verdict,
        verifierKind: verification.verifierKind,
        verifierLabel: verifierLabelOf(verification, labels),
        note: verification.note,
        evidenceUrls: [...verification.evidenceUrls],
        verifiedAt: verification.verifiedAt,
      })),
      resolution: {
        outcome: decision.outcome,
        reason: decision.reason,
        supporting: decision.supporting,
        refuting: decision.refuting,
        inconclusive: decision.inconclusive,
        conflicts: resolutionConflicts(claim, domainVerifications).map((conflict) => ({
          code: conflict.code,
          detail: conflict.detail,
        })),
        cautions: [...resolutionCautions(claim, domainVerifications)].slice(0, 10),
      },
      caveats: [
        ...resolutionCaveats(),
        ...slaCaveats(),
        ...attestationCaveats(),
      ].slice(0, 10),
    };
  }

  async responseAttestation(
    publicId: string,
    responseId: string,
  ): Promise<ResponseAttestationDocument> {
    const row = await this.run(
      async (tx) => this.repository.findResponseAttestation(tx, publicId, responseId),
      { scope: 'public', requestId: 'attestation-public' },
    );
    if (row === null) {
      throw new AppError('NOT_FOUND', { detail: 'Tanggapan tidak ditemukan.' });
    }
    const envelope: AttestationEnvelope = {
      reportPublicId: row.reportPublicId,
      institutionId: row.institutionId,
      kind: row.kind,
      bodyDigestHex: row.bodyDigestHex ?? '',
      evidenceUrls: row.evidenceUrls,
      publishedAt: row.publishedAt.toISOString(),
      correctsResponseId: row.correctsResponseId,
      signatureBase64: row.signatureBase64,
      signatureAlgorithm: row.signatureAlgorithm,
      signingKeyId: row.signingKeyId,
      publicKeyBase64: row.publicKeyBase64,
      signedAt: row.signedAt === null ? null : row.signedAt.toISOString(),
    };
    const verification =
      row.bodyDigestHex === null
        ? {
            status: 'unsigned' as const,
            message: 'Tanggapan ini tidak membawa sidik isi, jadi tidak dapat diverifikasi.',
          }
        : verifyResponseAttestation(envelope, (payload, signature, key) =>
            verifyResponseSignature({
              payload,
              publicKeyBase64: key,
              signatureBase64: signature,
            }),
          );
    return {
      responseId: row.responseId,
      reportPublicId: row.reportPublicId,
      institutionId: row.institutionId,
      kind: row.kind as ResponseAttestationDocument['kind'],
      bodyDigestHex: row.bodyDigestHex,
      evidenceUrls: row.evidenceUrls,
      publishedAt: row.publishedAt.toISOString(),
      correctsResponseId: row.correctsResponseId,
      canonicalPayload: attestationPayloadFrom(envelope),
      signatureBase64: row.signatureBase64,
      signatureAlgorithm: row.signatureAlgorithm,
      signingKeyId: row.signingKeyId,
      publicKeyBase64: row.publicKeyBase64,
      keyFingerprint: signingKeyFingerprint(row.publicKeyBase64),
      signedAt: envelope.signedAt,
      signed: attestationIsSigned(envelope),
      verification: { status: verification.status, message: verification.message },
    };
  }

  async caseFile(publicId: string, deviceHash?: string): Promise<CaseFile> {
    const now = new Date().toISOString();
    const loaded = await this.run(
      async (tx) => {
        const caseRow = await this.repository.findCase(tx, publicId);
        if (caseRow === null) {
          return null;
        }
        const [events, responses, verifications, closures, attestations, sla] =
          await Promise.all([
            this.repository.listEvents(tx, caseRow.id),
            this.repository.listResponses(tx, caseRow.id),
            this.repository.listVerifications(tx, caseRow.id),
            this.repository.listClosureAnswers(tx, caseRow.id),
            this.repository.listAttestations(tx, caseRow.id),
            this.repository.findSla(tx, caseRow.id),
          ]);
        return { caseRow, events, responses, verifications, closures, attestations, sla };
      },
      deviceHash === undefined
        ? { scope: 'public', requestId: 'accountability-public' }
        : { scope: 'citizen', deviceHash, requestId: `case-own-${deviceHash.slice(0, 8)}` },
    );
    if (loaded === null) {
      if (deviceHash === undefined) {
        throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
      }
      return this.caseFile(publicId);
    }
    const attestations = new Map(
      loaded.attestations.map((entry) => [entry.responseId, entry]),
    );
    const mapped: ReportResponse[] = loaded.responses.map((response) => {
      const record = attestations.get(response.id);
      return {
        id: response.id,
        kind: response.kind,
        body: response.body,
        evidenceUrls: [...response.evidenceUrls],
        institutionId: response.institutionId,
        institutionName: response.institutionName,
        authorDisplayName: response.authorDisplayName,
        correctsResponseId: response.correctsResponseId,
        publishedAt: response.publishedAt.toISOString(),
        attestation: attestationView({
          body: response.body,
          reportPublicId: loaded.caseRow.publicId,
          institutionId: response.institutionId,
          kind: response.kind,
          evidenceUrls: response.evidenceUrls,
          publishedAt: response.publishedAt,
          correctsResponseId: response.correctsResponseId,
          bodyDigestHex: record?.bodyDigestHex ?? null,
          signatureBase64: record?.signatureBase64 ?? null,
          signatureAlgorithm: record?.signatureAlgorithm ?? null,
          signingKeyId: record?.signingKeyId ?? null,
          publicKeyBase64: record?.publicKeyBase64 ?? null,
          signedAt: record?.signedAt ?? null,
        }),
      };
    });
    return this.buildCaseFile(
      loaded.caseRow,
      loaded.events,
      mapped,
      loaded.verifications,
      loaded.closures,
      loaded.sla,
      now,
    );
  }

  async partnerCaseFile(
    publicId: string,
    session: PartnerSession,
  ): Promise<CaseFile> {
    const now = new Date().toISOString();
    const loaded = await this.run(
      async (tx) => {
        const caseRow = await this.repository.findCase(tx, publicId);
        if (caseRow === null || caseRow.institutionId !== session.institutionId) {
          return null;
        }
        const [events, responses, verifications, closures, attestations, sla] =
          await Promise.all([
            this.repository.listEvents(tx, caseRow.id),
            this.repository.listResponses(tx, caseRow.id),
            this.repository.listVerifications(tx, caseRow.id),
            this.repository.listClosureAnswers(tx, caseRow.id),
            this.repository.listAttestations(tx, caseRow.id),
            this.repository.findSla(tx, caseRow.id),
          ]);
        return { caseRow, events, responses, verifications, closures, attestations, sla };
      },
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-case-${session.userId.slice(0, 8)}`,
      },
    );
    if (loaded === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    const attestations = new Map(
      loaded.attestations.map((entry) => [entry.responseId, entry]),
    );
    const mapped: ReportResponse[] = loaded.responses.map((response) => {
      const record = attestations.get(response.id);
      return {
        id: response.id,
        kind: response.kind,
        body: response.body,
        evidenceUrls: [...response.evidenceUrls],
        institutionId: response.institutionId,
        institutionName: response.institutionName,
        authorDisplayName: response.authorDisplayName,
        correctsResponseId: response.correctsResponseId,
        publishedAt: response.publishedAt.toISOString(),
        attestation: attestationView({
          body: response.body,
          reportPublicId: loaded.caseRow.publicId,
          institutionId: response.institutionId,
          kind: response.kind,
          evidenceUrls: response.evidenceUrls,
          publishedAt: response.publishedAt,
          correctsResponseId: response.correctsResponseId,
          bodyDigestHex: record?.bodyDigestHex ?? null,
          signatureBase64: record?.signatureBase64 ?? null,
          signatureAlgorithm: record?.signatureAlgorithm ?? null,
          signingKeyId: record?.signingKeyId ?? null,
          publicKeyBase64: record?.publicKeyBase64 ?? null,
          signedAt: record?.signedAt ?? null,
        }),
      };
    });
    return this.buildCaseFile(
      loaded.caseRow,
      loaded.events,
      mapped,
      loaded.verifications,
      loaded.closures,
      loaded.sla,
      now,
    );
  }

  async addResponse(
    publicId: string,
    input: ResponseCreate,
    session: PartnerSession,
  ): Promise<ReportResponse> {
    const created = await this.run(
      async (tx) => {
        const caseRow = await this.repository.lockCase(tx, publicId);
        if (caseRow === null || caseRow.institutionId !== session.institutionId) {
          return null;
        }
        if (
          caseRow.status === 'rejected' ||
          caseRow.status === 'closed' ||
          caseRow.status === 'verified_resolved'
        ) {
          throw new AppError('INVALID_TRANSITION', {
            detail: `Tanggapan tidak dapat ditambahkan pada status ${caseRow.status}.`,
          });
        }
        const publishedAt = new Date();
        const signer = responseSigner();
        const digest = sha256Hex(input.body);
        const signature =
          signer === null
            ? null
            : signer.sign(
                canonicalResponsePayload({
                  reportPublicId: publicId,
                  institutionId: session.institutionId,
                  kind: input.kind,
                  bodyDigestHex: digest.toString('hex'),
                  evidenceUrls: input.evidenceUrls,
                  publishedAt: publishedAt.toISOString(),
                  correctsResponseId: input.correctsResponseId ?? null,
                }),
              );
        const responseId = await this.repository.insertResponse(tx, {
          reportId: caseRow.id,
          institutionId: session.institutionId,
          authorUserId: session.userId,
          kind: input.kind,
          body: input.body,
          evidenceUrls: input.evidenceUrls,
          correctsResponseId: input.correctsResponseId ?? null,
          publishedAt,
          attestation:
            signer === null || signature === null
              ? null
              : {
                  bodyDigest: digest,
                  signature,
                  algorithm: ATTESTATION_ALGORITHM,
                  keyId: signer.keyId,
                  publicKey: Buffer.from(signer.publicKeyBase64, 'base64'),
                  signedAt: publishedAt,
                },
        });
        await this.reports.appendEvent(tx, caseRow.id, {
          kind: 'responded',
          actorType: 'partner',
          actorId: session.userId,
          payload: {
            responseId,
            kind: input.kind,
            evidenceCount: input.evidenceUrls.length,
            corrected: input.correctsResponseId ?? null,
          },
          sourceUrl: input.evidenceUrls[0] ?? null,
        });
        return {
          responseId,
          caseRow,
          publishedAt,
          attestation:
            signer === null || signature === null
              ? null
              : attestationView({
                  body: input.body,
                  reportPublicId: publicId,
                  institutionId: session.institutionId,
                  kind: input.kind,
                  evidenceUrls: input.evidenceUrls,
                  publishedAt,
                  correctsResponseId: input.correctsResponseId ?? null,
                  bodyDigestHex: digest.toString('hex'),
                  signatureBase64: signature.toString('base64'),
                  signatureAlgorithm: ATTESTATION_ALGORITHM,
                  signingKeyId: signer.keyId,
                  publicKeyBase64: signer.publicKeyBase64,
                  signedAt: publishedAt,
                }),
        };
      },
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `partner-response-${session.userId.slice(0, 8)}`,
      },
    );

    if (created === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'report.response_published',
      objectType: 'report',
      objectId: publicId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: { kind: input.kind, evidenceCount: input.evidenceUrls.length },
    });
    return {
      id: created.responseId,
      kind: input.kind,
      body: input.body,
      evidenceUrls: [...input.evidenceUrls],
      institutionId: session.institutionId,
      institutionName: session.institutionName,
      authorDisplayName: session.displayName,
      correctsResponseId: input.correctsResponseId ?? null,
      publishedAt: created.publishedAt.toISOString(),
      attestation: created.attestation,
    };
  }

  async verifyResolution(
    publicId: string,
    input: ResolutionVerifyInput,
    verifier: { adminId: string },
  ): Promise<ResolutionVerifyResult> {
    const verifierInstitutionId: string | null = null;
    const verifierUserId: string | null = null;
    const verifierKind = 'platform';

    const outcome = await this.run(
      async (tx) => {
        const caseRow = await this.repository.lockCase(tx, publicId);
        if (caseRow === null) {
          return null;
        }
        if (caseRow.status !== 'claimed_resolved' && caseRow.status !== 'disputed') {
          throw new AppError('INVALID_TRANSITION', {
            detail: `Verifikasi hanya berlaku untuk status claimed_resolved atau disputed, bukan ${caseRow.status}.`,
          });
        }
        if (caseRow.institutionId === null) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Laporan tanpa institusi tidak dapat diverifikasi penyelesaiannya.',
          });
        }
        if (verifierInstitutionId === caseRow.institutionId) {
          throw new AppError('FORBIDDEN', {
            detail: 'Institusi yang mengklaim selesai tidak boleh memverifikasi klaimnya sendiri.',
          });
        }

        await this.repository.insertVerification(tx, {
          reportId: caseRow.id,
          method: input.method,
          verdict: input.verdict,
          verifierKind,
          verifierInstitutionId,
          verifierUserId,
          claimantInstitutionId: caseRow.institutionId,
          note: input.note ?? null,
          evidenceUrls: input.evidenceUrls,
        });

        const verifications = await this.repository.listVerifications(tx, caseRow.id);
        const claim = this.claimOf(caseRow);
        const decision = decideResolution(claim, verifications.map(toDomainVerification));
        const previousStatus = caseRow.status;

        if (decision.status !== previousStatus) {
          await this.reports.updateStatus(tx, caseRow.id, decision.status, null);
          await this.reports.appendEvent(tx, caseRow.id, {
            kind: decision.status === 'disputed' ? 'disputed' : 'verified_resolved',
            actorType: 'superadmin',
            actorId: verifier.adminId,
            payload: {
              method: input.method,
              verdict: input.verdict,
              outcome: decision.outcome,
              supporting: decision.supporting,
              refuting: decision.refuting,
            },
            sourceUrl: input.evidenceUrls[0] ?? null,
          });
        }

        return {
          publicId,
          status: decision.status,
          previousStatus,
          outcome: decision.outcome,
          conflicts: resolutionConflicts(claim, verifications.map(toDomainVerification)).map(
            (conflict) => ({ code: conflict.code, detail: conflict.detail }),
          ),
        };
      },
      { scope: 'admin', userId: verifier.adminId, requestId: 'admin-verify' },
    );

    if (outcome === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'report.resolution_verified',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'superadmin', userId: verifier.adminId },
      payload: { verdict: input.verdict, method: input.method, outcome: outcome.outcome },
    });
    return {
      publicId: outcome.publicId,
      status: outcome.status,
      previousStatus: outcome.previousStatus,
      outcome: outcome.outcome,
      conflicts: outcome.conflicts,
    };
  }

  async breaches(limit: number, minEscalation: number): Promise<SlaBreachItem[]> {
    const now = new Date();
    const rows = await this.repository.listBreaches(db, limit);
    const items: SlaBreachItem[] = [];
    for (const row of rows) {
      const worst = worstPhase(
        {
          reportId: row.publicId,
          policyVersion: 'sla-v1',
          priority: row.priority,
          acknowledgeHours: 0,
          respondHours: 0,
          resolveHours: 0,
          acknowledgeDue: row.acknowledgeDue,
          respondDue: row.respondDue,
          resolveDue: row.resolveDue,
        },
        now,
      );
      if (worst === null) {
        continue;
      }
      const escalation = escalationsOf(
        {
          reportId: row.publicId,
          policyVersion: 'sla-v1',
          priority: row.priority,
          acknowledgeHours: 0,
          respondHours: 0,
          resolveHours: 0,
          acknowledgeDue: row.acknowledgeDue,
          respondDue: row.respondDue,
          resolveDue: row.resolveDue,
        },
        now,
      );
      if (escalation < minEscalation) {
        continue;
      }
      items.push({
        publicId: row.publicId,
        category: row.category,
        status: row.status,
        institutionName: row.institutionName,
        priority: row.priority as SlaPriority,
        phase: worst.phase,
        dueAt: worst.dueAt.toISOString(),
        hoursLate: worst.hoursLate,
        escalation,
      });
    }
    return items;
  }

  describePhase(state: Parameters<typeof describeSlaPhase>[0]): string {
    return describeSlaPhase(state);
  }

  slaViewOf(row: SlaRow, events: readonly EventRow[], now: string): SlaView {
    return toSlaView(row, slaMilestonesOf(events), now);
  }

  static isoOf(value: Date | null): string | null {
    return iso(value);
  }
}
