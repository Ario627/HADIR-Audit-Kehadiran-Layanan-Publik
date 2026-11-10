import { Inject, Injectable } from '@nestjs/common';
import {
  appealAdmissibility,
  appealGroundsLabel,
  appealOutcomeEffect,
  appealWindow,
  describeAppeal,
  describeScorecard,
  panelCaveats,
  panelEligibility,
  panelQuorum,
  panelRefusalMessage,
  panelStrength,
  rankInstitutions,
  scorecardCaveats,
  scorecardFor,
  type MemberRole,
} from '@hadir/domain';
import type {
  AppealCreate,
  AppealDecisionInput,
  AppealDecisionResult,
  AppealQueueQuery,
  AppealStatus,
  AppealView,
  CitySlaOverrideInput,
  CitySlaOverrideView,
  InstitutionScorecard,
  InstitutionScorecardList,
  PanelCandidates,
  PanelCandidateView,
  PanelInviteInput,
  PanelView,
} from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { AuditService } from '../../common/audit/audit.service';
import type { PartnerSession } from '../../common/auth/partner-session';
import type { DeviceIdentity } from '../../common/http/request-context';
import { db } from '../../db/client';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import {
  GovernanceRepository,
  type AppealRow,
  type PanelGrantRow,
} from '../../db/repositories/governance.repository';
import { ReportsRepository } from '../../db/repositories/reports.repository';

const PARTNER_WRITE_ROLES: readonly MemberRole[] = ['admin', 'responder'];

function requirePartnerWriteRole(session: PartnerSession): void {
  if (!PARTNER_WRITE_ROLES.includes(session.role)) {
    throw new AppError('FORBIDDEN', {
      detail: 'Peran viewer tidak dapat mengubah panel atau vonis.',
    });
  }
}

function toPanelView(
  publicId: string,
  cityId: string,
  grants: readonly PanelGrantRow[],
  selfInstitutionId: string | null,
): PanelView {
  const claimant = grants[0];
  const activeVerifiers = grants.filter(
    (grant) => grant.status === 'active' && grant.role === 'verifier',
  );
  const quorum = panelQuorum(activeVerifiers.length);
  const kinds = new Set(activeVerifiers.map((grant) => grant.institutionId));
  return {
    publicId,
    cityId,
    claimantInstitutionId: claimant?.claimantInstitutionId ?? '',
    claimantInstitutionName: claimant?.claimantInstitutionName ?? 'Instansi tidak tercatat',
    grants: grants.map((grant) => ({
      id: grant.id,
      institutionId: grant.institutionId,
      institutionName: grant.institutionName,
      role: grant.role,
      status: grant.status,
      isOwnInstitution: grant.institutionId === selfInstitutionId,
      createdAt: grant.createdAt.toISOString(),
      decidedAt: grant.decidedAt === null ? null : grant.decidedAt.toISOString(),
      revokedAt: grant.revokedAt === null ? null : grant.revokedAt.toISOString(),
    })),
    quorum,
    strength: panelStrength(activeVerifiers.length, kinds.size),
    canVerify:
      selfInstitutionId !== null &&
      activeVerifiers.some((grant) => grant.institutionId === selfInstitutionId),
    caveats: [...panelCaveats()].slice(0, 4),
    summary:
      grants.length === 0
        ? 'Belum ada panel untuk laporan ini.'
        : `${panelQuorum(activeVerifiers.length).present} verifier aktif dari ${grants.length} undangan.`,
  };
}

function toAppealView(row: AppealRow, now: string): AppealView {
  const window = appealWindow(row.grounds, row.decidedAt?.toISOString() ?? row.createdAt.toISOString(), now);
  return {
    id: row.id,
    publicId: row.publicId,
    grounds: row.grounds,
    groundsLabel: appealGroundsLabel(row.grounds),
    status: row.status,
    statement: row.statement,
    evidenceUrls: [...row.evidenceUrls],
    decisionNote: row.decisionNote,
    outcomeTransition: row.outcomeTransition,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    windowDeadline: window.deadline,
    windowOpen: window.open,
    createdAt: row.createdAt.toISOString(),
    summary: describeAppeal(row.grounds, row.status, null),
  };
}

@Injectable()
export class GovernanceService {
  constructor(
    private readonly repository: GovernanceRepository,
    private readonly reports: ReportsRepository,
    private readonly audit: AuditService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  async panel(
    publicId: string,
    selfInstitutionId: string | null,
  ): Promise<PanelView> {
    const loaded = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null || report.cityId === null) {
          return null;
        }
        const grants = await this.repository.listPanelGrants(tx, report.id);
        return { report, grants, cityId: report.cityId };
      },
      { scope: 'public', requestId: 'panel-read' },
    );
    if (loaded === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Laporan tidak ditemukan atau belum memiliki kota.',
      });
    }
    return toPanelView(
      loaded.report.publicId,
      loaded.cityId,
      loaded.grants,
      selfInstitutionId,
    );
  }

  async panelCandidates(publicId: string): Promise<PanelCandidates> {
    const loaded = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null || report.cityId === null || report.institutionId === null) {
          return null;
        }
        const rows = await this.repository.listPanelCandidates(
          tx,
          report.id,
          report.cityId,
        );
        return { report, rows };
      },
      { scope: 'admin', requestId: 'panel-candidates' },
    );
    if (loaded === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Laporan tidak ditemukan, tanpa kota, atau tanpa instansi penanggung jawab.',
      });
    }
    const candidates: PanelCandidateView[] = loaded.rows.map((row) => {
      const grantRevoked = row.grantStatus === 'revoked' && row.grantRevokedAt !== null;
      const eligibility = panelEligibility({
        claimantInstitutionId: loaded.report.institutionId as string,
        claimantCityId: loaded.report.cityId,
        candidate: {
          institutionId: row.institutionId,
          displayName: row.displayName,
          cityId: row.cityId,
          activeGrant:
            row.grantId !== null && row.grantRole !== null && row.grantStatus !== null
              ? {
                  id: row.grantId,
                  institutionId: row.institutionId,
                  role: row.grantRole,
                  status: row.grantStatus,
                  cityId: loaded.report.cityId as string,
                  createdAt: '',
                  revokedAt: grantRevoked ? 'revoked' : null,
                }
              : null,
        },
      });
      return {
        institutionId: row.institutionId,
        displayName: row.displayName,
        eligible: eligibility.eligible,
        role: eligibility.role,
        refusal: eligibility.refusal,
        reason:
          eligibility.refusal === null
            ? eligibility.reason
            : panelRefusalMessage(eligibility.refusal),
      };
    });
    return {
      publicId: loaded.report.publicId,
      cityId: loaded.report.cityId,
      candidates,
    };
  }

  async invitePanelMember(
    publicId: string,
    input: PanelInviteInput,
    adminId: string,
  ): Promise<PanelView> {
    const created = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null) {
          return { error: 'not_found' as const };
        }
        if (report.cityId === null || report.institutionId === null) {
          return { error: 'no_city' as const };
        }
        if (input.institutionId === report.institutionId) {
          return { error: 'self' as const };
        }
        const candidate = await this.repository.findInstitution(tx, input.institutionId);
        if (candidate === null) {
          return { error: 'unknown_institution' as const };
        }
        if (candidate.cityId !== report.cityId) {
          return { error: 'different_city' as const };
        }
        const id = await this.repository.upsertPanelGrant(tx, {
          reportId: report.id,
          institutionId: input.institutionId,
          claimantInstitutionId: report.institutionId,
          cityId: report.cityId,
          role: input.role,
          invitedBy: adminId,
        });
        if (id === null) {
          return { error: 'revoked' as const };
        }
        const grants = await this.repository.listPanelGrants(tx, report.id);
        return { report, grants };
      },
      { scope: 'admin', userId: adminId, requestId: 'panel-invite' },
    );

    if ('error' in created) {
      const detail =
        created.error === 'self'
          ? 'Institusi pengklaim tidak dapat menjadi panel untuk laporannya sendiri.'
          : created.error === 'different_city'
            ? 'Panel lintas instansi hanya berlaku dalam satu kota.'
            : created.error === 'revoked'
              ? 'Akses panel institusi ini pernah dicabut dan tidak dapat dipulihkan otomatis.'
              : created.error === 'unknown_institution'
                ? 'Institusi tidak ditemukan.'
                : created.error === 'no_city'
                  ? 'Laporan belum memiliki kota sehingga tidak dapat membentuk panel.'
                  : 'Laporan tidak ditemukan.';
      throw new AppError(created.error === 'not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED', {
        detail,
      });
    }

    await this.audit.record({
      action: 'admin.panel_granted',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'superadmin', userId: adminId },
      payload: { institutionId: input.institutionId, role: input.role },
    });
    return toPanelView(
      created.report.publicId,
      created.report.cityId as string,
      created.grants,
      null,
    );
  }

  async revokePanelMember(
    publicId: string,
    institutionId: string,
    adminId: string,
  ): Promise<PanelView> {
    const result = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null) {
          return null;
        }
        const revoked = await this.repository.revokePanelGrant(
          tx,
          report.id,
          institutionId,
        );
        if (!revoked) {
          return null;
        }
        const grants = await this.repository.listPanelGrants(tx, report.id);
        return { report, grants };
      },
      { scope: 'admin', userId: adminId, requestId: 'panel-revoke' },
    );
    if (result === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Panel atau institusi tidak ditemukan pada laporan ini.',
      });
    }
    await this.audit.record({
      action: 'admin.panel_revoked',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'superadmin', userId: adminId },
      payload: { institutionId },
    });
    return toPanelView(
      result.report.publicId,
      result.report.cityId as string,
      result.grants,
      null,
    );
  }

  async partnerPanelReports(
    session: PartnerSession,
    limit: number,
  ): Promise<{
    items: {
      publicId: string;
      status: string;
      category: string;
      claimantName: string;
      role: string;
    }[];
    count: number;
  }> {
    const items = await this.run(
      async (tx) =>
        this.repository.panelReportsForInstitution(tx, session.institutionId, limit),
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `panel-list-${session.userId.slice(0, 8)}`,
      },
    );
    return { items, count: items.length };
  }

  async submitAppeal(
    publicId: string,
    input: AppealCreate,
    device: DeviceIdentity,
  ): Promise<AppealView> {
    const now = new Date().toISOString();
    const created = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null || report.deviceHash !== device.hash) {
          return { error: 'not_found' as const };
        }
        const counts = await this.repository.countAppealsForReport(tx, report.id);
        const decidedAt = await this.repository.findDecisionMoment(
          tx,
          report.id,
          report.createdAt,
        );
        const admissibility = appealAdmissibility({
          grounds: input.grounds,
          reportStatus: report.status,
          decidedAt: decidedAt.toISOString(),
          submittedAt: now,
          now,
          priorAppeals: counts.total,
        });
        if (!admissibility.admissible) {
          return { error: 'inadmissible' as const, detail: admissibility.message };
        }
        const id = await this.repository.insertAppeal(tx, {
          reportId: report.id,
          deviceHash: device.hash,
          grounds: input.grounds,
          statement: input.statement,
          evidenceUrls: input.evidenceUrls,
        });
        if (id === null) {
          return {
            error: 'duplicate' as const,
            detail: 'Banding untuk alasan ini sudah ada.',
          };
        }
        await this.reports.appendEvent(tx, report.id, {
          kind: 'disputed',
          actorType: 'citizen',
          actorId: null,
          payload: { appealId: id, grounds: input.grounds },
          sourceUrl: input.evidenceUrls[0] ?? null,
        });
        const appeals = await this.repository.listAppeals(tx, report.id);
        const appeal = appeals.find((entry) => entry.id === id);
        return appeal === undefined
          ? { error: 'not_found' as const }
          : { appeal };
      },
      {
        scope: 'citizen',
        deviceHash: device.hash,
        requestId: `appeal-${device.hash.slice(0, 8)}`,
      },
    );

    if ('error' in created) {
      if (created.error === 'inadmissible') {
        throw new AppError('INVALID_TRANSITION', { detail: created.detail });
      }
      if (created.error === 'duplicate') {
        throw new AppError('INVALID_TRANSITION', { detail: created.detail });
      }
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }

    await this.audit.record({
      action: 'report.appeal_submitted',
      objectType: 'report',
      objectId: publicId,
      actor: { kind: 'citizen', deviceHash: device.hash },
      payload: { grounds: input.grounds, evidenceCount: input.evidenceUrls.length },
    });
    return toAppealView(created.appeal, now);
  }

  async reportAppeals(publicId: string, device: DeviceIdentity): Promise<AppealView[]> {
    const now = new Date().toISOString();
    const rows = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null || report.deviceHash !== device.hash) {
          return null;
        }
        return this.repository.listAppeals(tx, report.id);
      },
      {
        scope: 'citizen',
        deviceHash: device.hash,
        requestId: `appeal-read-${device.hash.slice(0, 8)}`,
      },
    );
    if (rows === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    return rows.map((row) => toAppealView(row, now));
  }

  async myAppeals(device: DeviceIdentity, limit: number): Promise<AppealView[]> {
    const now = new Date().toISOString();
    const rows = await this.run(
      async (tx) => this.repository.listAppealsForDevice(tx, device.hash, limit),
      {
        scope: 'citizen',
        deviceHash: device.hash,
        requestId: `appeal-mine-${device.hash.slice(0, 8)}`,
      },
    );
    return rows.map((row) => toAppealView(row, now));
  }

  async appealQueue(query: AppealQueueQuery): Promise<AppealView[]> {
    const now = new Date().toISOString();
    const rows = await this.repository.listAppealQueue(
      db,
      query.status,
      query.limit,
    );
    return rows.map((row) => toAppealView(row, now));
  }

  async decideAppeal(
    appealId: string,
    input: AppealDecisionInput,
    adminId: string,
  ): Promise<AppealDecisionResult> {
    const outcome = await this.run(
      async (tx) => {
        const appeal = await this.repository.findAppeal(tx, appealId);
        if (appeal === null) {
          return null;
        }
        if (appeal.status !== 'submitted' && appeal.status !== 'admitted') {
          throw new AppError('INVALID_TRANSITION', {
            detail: `Banding sudah diputuskan dengan status ${appeal.status}.`,
          });
        }
        const status: AppealStatus =
          input.outcome === 'inadmissible'
            ? 'inadmissible'
            : input.outcome === 'upheld'
              ? 'upheld'
              : 'overturned';
        const effect = appealOutcomeEffect(
          appeal.grounds,
          input.outcome === 'inadmissible' ? null : input.outcome,
          appeal.reportStatus,
        );
        const decided = await this.repository.decideAppeal(tx, {
          appealId,
          status,
          adminId,
          note: input.note,
          transition: effect.toStatus,
        });
        if (!decided) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Banding tidak dapat diputuskan pada status saat ini.',
          });
        }
        if (effect.toStatus !== effect.fromStatus) {
          await this.reports.updateStatus(
            tx,
            appeal.reportId,
            effect.toStatus as never,
            effect.toStatus === 'verified_resolved' ? new Date() : null,
          );
          await this.reports.appendEvent(tx, appeal.reportId, {
            kind: effect.toStatus === 'disputed' ? 'disputed' : 'corrected',
            actorType: 'superadmin',
            actorId: adminId,
            payload: {
              appealId,
              grounds: appeal.grounds,
              outcome: input.outcome,
              from: effect.fromStatus,
              to: effect.toStatus,
            },
            sourceUrl: null,
          });
        }
        return {
          appealId,
          publicId: appeal.publicId,
          status,
          outcome: input.outcome,
          reportStatus: effect.toStatus,
          previousReportStatus: effect.fromStatus,
        };
      },
      { scope: 'admin', userId: adminId, requestId: 'appeal-decide' },
    );

    if (outcome === null) {
      throw new AppError('NOT_FOUND', { detail: 'Banding tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'admin.appeal_decided',
      objectType: 'report',
      objectId: outcome.publicId,
      actor: { kind: 'superadmin', userId: adminId },
      payload: { outcome: input.outcome, transition: outcome.reportStatus },
    });
    return outcome;
  }

  async scorecard(
    institutionId: string,
    windowDays: number,
  ): Promise<InstitutionScorecard> {
    const institution = await this.repository.findInstitution(db, institutionId);
    if (institution === null) {
      throw new AppError('NOT_FOUND', { detail: 'Instansi tidak ditemukan.' });
    }
    const counts = await this.repository.scorecardCounts(db, institutionId, windowDays);
    const card = scorecardFor({ ...counts, windowDays });
    return {
      institutionId: institution.id,
      institutionName: institution.name,
      cityId: institution.cityId,
      cityName: institution.cityName,
      windowDays,
      state: card.state,
      overall: card.overall,
      band: card.band,
      rank: null,
      dimensions: card.dimensions.map((entry) => ({
        dimension: entry.dimension,
        value: entry.value,
        band: entry.band,
        numerator: entry.numerator,
        denominator: entry.denominator,
        label: entry.label,
      })),
      sample: card.sample,
      warnings: [...card.warnings],
      summary: describeScorecard(card),
      caveats: [...scorecardCaveats()].slice(0, 5),
    };
  }

  async scorecards(
    cityId: string | null,
    windowDays: number,
  ): Promise<InstitutionScorecardList> {
    const institutions = await this.repository.listInstitutions(db, cityId);
    const cards: InstitutionScorecard[] = [];
    for (const institution of institutions) {
      const counts = await this.repository.scorecardCounts(db, institution.id, windowDays);
      const card = scorecardFor({ ...counts, windowDays });
      cards.push({
        institutionId: institution.id,
        institutionName: institution.name,
        cityId: institution.cityId,
        cityName: institution.cityName,
        windowDays,
        state: card.state,
        overall: card.overall,
        band: card.band,
        rank: null,
        dimensions: card.dimensions.map((entry) => ({
          dimension: entry.dimension,
          value: entry.value,
          band: entry.band,
          numerator: entry.numerator,
          denominator: entry.denominator,
          label: entry.label,
        })),
        sample: card.sample,
        warnings: [...card.warnings],
        summary: describeScorecard(card),
        caveats: [...scorecardCaveats()].slice(0, 5),
      });
    }
    const ranked = rankInstitutions(
      cards.map((card) => ({
        institutionId: card.institutionId,
        name: card.institutionName,
        scorecard: scorecardFor({
          reportsReceived: card.sample.reportsReceived,
          reportsAcknowledged: card.dimensions[0]?.numerator ?? 0,
          reportsResponded: 0,
          slaTracked: card.sample.slaTracked,
          slaMet: card.dimensions[1]?.numerator ?? 0,
          claimsResolved: card.dimensions[2]?.denominator ?? 0,
          claimsVerified: card.dimensions[2]?.numerator ?? 0,
          claimsDisputed: 0,
          appealsDecided: card.sample.appealsDecided,
          appealsOverturned:
            (card.dimensions[3]?.denominator ?? 0) - (card.dimensions[3]?.numerator ?? 0),
          windowDays,
        }),
        rank: null,
      })),
    );
    const ranks = new Map(ranked.map((entry) => [entry.institutionId, entry.rank]));
    return {
      items: cards.map((card) => ({ ...card, rank: ranks.get(card.institutionId) ?? null })),
      cityId,
      generatedAt: new Date().toISOString(),
      caveats: [...scorecardCaveats()].slice(0, 5),
    };
  }

  async citySlaOverrides(cityId: string): Promise<CitySlaOverrideView[]> {
    const rows = await this.repository.listCitySlaOverrides(db, cityId);
    return rows.map((row) => ({
      cityId: row.cityId,
      cityName: row.cityName,
      priority: row.priority as CitySlaOverrideView['priority'],
      acknowledgeHours: row.acknowledgeHours,
      respondHours: row.respondHours,
      resolveHours: row.resolveHours,
      sourceUrl: row.sourceUrl,
      note: row.note,
    }));
  }

  async upsertCitySlaOverride(
    cityId: string,
    input: CitySlaOverrideInput,
    adminId: string,
  ): Promise<CitySlaOverrideView> {
    const ok = await this.run(
      async (tx) =>
        this.repository.upsertCitySlaOverride(tx, {
          cityId,
          priority: input.priority,
          acknowledgeHours: input.acknowledgeHours,
          respondHours: input.respondHours,
          resolveHours: input.resolveHours,
          sourceUrl: input.sourceUrl,
          note: input.note ?? null,
        }),
      { scope: 'admin', userId: adminId, requestId: 'city-sla' },
    );
    if (!ok) {
      throw new AppError('VALIDATION_FAILED', { detail: 'Override SLA kota gagal disimpan.' });
    }
    await this.audit.record({
      action: 'admin.city_sla_set',
      objectType: 'system',
      objectId: cityId,
      actor: { kind: 'superadmin', userId: adminId },
      payload: { priority: input.priority },
    });
    const rows = await this.repository.listCitySlaOverrides(db, cityId);
    const saved = rows.find((row) => row.priority === input.priority);
    if (saved === undefined) {
      throw new AppError('INTERNAL_ERROR', { detail: 'Override tersimpan tetapi tidak terbaca.' });
    }
    return {
      cityId: saved.cityId,
      cityName: saved.cityName,
      priority: saved.priority as CitySlaOverrideView['priority'],
      acknowledgeHours: saved.acknowledgeHours,
      respondHours: saved.respondHours,
      resolveHours: saved.resolveHours,
      sourceUrl: saved.sourceUrl,
      note: saved.note,
    };
  }

  async verifyAsPanel(
    publicId: string,
    input: {
      method: 'field_inspection' | 'panel_review';
      verdict: 'confirmed' | 'refuted' | 'inconclusive';
      note?: string;
      evidenceUrls?: readonly string[];
    },
    session: PartnerSession,
  ): Promise<{ publicId: string; status: string; applied: boolean }> {
    requirePartnerWriteRole(session);
    const evidenceUrls = input.evidenceUrls ?? [];
    const result = await this.run(
      async (tx) => {
        const report = await this.repository.findReportContext(tx, publicId);
        if (report === null) {
          return null;
        }
        const isVerifier = await this.repository.findActiveVerifier(
          tx,
          report.id,
          session.institutionId,
        );
        if (!isVerifier) {
          throw new AppError('FORBIDDEN', {
            detail: 'Institusi Anda bukan verifier panel aktif untuk laporan ini.',
          });
        }
        if (report.status !== 'claimed_resolved' && report.status !== 'disputed') {
          throw new AppError('INVALID_TRANSITION', {
            detail: `Vonis panel hanya berlaku untuk claimed_resolved atau disputed, bukan ${report.status}.`,
          });
        }
        const nextStatus = input.verdict === 'refuted' ? 'disputed' : 'verified_resolved';
        const applied = await this.repository.applyPanelVerdict(tx, report.id, nextStatus, {
          method: input.method,
          verdict: input.verdict,
          note: input.note ?? null,
          evidenceUrls,
        });
        await this.reports.appendEvent(tx, report.id, {
          kind: nextStatus === 'disputed' ? 'disputed' : 'verified_resolved',
          actorType: 'partner',
          actorId: session.userId,
          payload: {
            method: input.method,
            verdict: input.verdict,
            panelInstitutionId: session.institutionId,
            from: report.status,
            to: nextStatus,
          },
          sourceUrl: evidenceUrls[0] ?? null,
        });
        return { publicId, status: applied, applied: true };
      },
      {
        scope: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        requestId: `panel-verdict-${session.userId.slice(0, 8)}`,
      },
    );
    if (result === null) {
      throw new AppError('NOT_FOUND', { detail: 'Laporan tidak ditemukan.' });
    }
    await this.audit.record({
      action: 'report.panel_verdict',
      objectType: 'report',
      objectId: publicId,
      actor: {
        kind: 'partner',
        userId: session.userId,
        institutionId: session.institutionId,
        role: session.role,
      },
      payload: { verdict: input.verdict, method: input.method, status: result.status },
    });
    return result;
  }
}
