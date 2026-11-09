import { Inject, Injectable } from '@nestjs/common';
import { db } from '../../db/client';
import {
  analyzeRepresentativeness,
  benchmarkMessage,
  annotateObservations,
  commitmentChanges,
  describeCommitment,
  qualityBreakdown,
  resolveBenchmark,
  resolveBenchmarkForStop,
  summariseContext,
  verifyReproducibility,
  type CommitmentRecord,
  type OperationalEvent,
} from '@hadir/domain';
import type {
  Benchmark,
  Commitment,
  CommitmentCreate,
  CommitmentHistoryQuery,
  CommitmentQuery,
  ContextQuery,
  ContextTimeline,
  EvidencePack,
  EvidenceQuery,
  IncidentCreate,
  OperationalContext,
  ProvenanceDocument,
  AnalysisSnapshot,
} from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { TRANSACTION_RUNNER, type TransactionRunner } from '../../db/transaction-runner';
import {
  EvidenceRepository,
  type CommitmentRow,
  type ContextRow,
  type SnapshotRow,
} from '../../db/repositories/evidence.repository';
import { StopsService } from '../stops/stops.service';
import { EstimatesService } from '../estimates/estimates.service';

const DAY_MS = 86_400_000;
const CONTEXT_LOOKBACK_DAYS = 30;

function toRecord(row: CommitmentRow): CommitmentRecord {
  return {
    id: row.id,
    routeId: row.routeId,
    stopId: row.stopId,
    kind: row.kind,
    dayScope: row.dayScope,
    headwayMin: row.headwayMin,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
    sourceDocumentUrl: row.sourceDocumentUrl,
    sourceDocumentTitle: row.sourceDocumentTitle,
    sourceDocumentVersion: row.sourceDocumentVersion,
    status: row.status,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    institutionName: row.institutionName,
  };
}

function toCommitment(row: CommitmentRow): Commitment {
  return {
    id: row.id,
    routeId: row.routeId,
    stopId: row.stopId,
    kind: row.kind,
    dayScope: row.dayScope,
    headwayMin: row.headwayMin,
    spanStart: row.spanStart,
    spanEnd: row.spanEnd,
    sourceDocumentUrl: row.sourceDocumentUrl,
    sourceDocumentTitle: row.sourceDocumentTitle,
    sourceDocumentVersion: row.sourceDocumentVersion,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    status: row.status,
    verifiedAt: row.verifiedAt === null ? null : row.verifiedAt.toISOString(),
    institutionName: row.institutionName,
  };
}

function toContext(row: ContextRow): OperationalContext {
  return {
    id: row.id,
    kind: row.kind,
    impact: row.impact,
    text: row.text,
    sourceUrl: row.sourceUrl,
    startsAt: row.startsAt === null ? null : row.startsAt.toISOString(),
    endsAt: row.endsAt === null ? null : row.endsAt.toISOString(),
    stopId: row.stopId,
    routeId: row.routeId,
    acknowledgedAt: row.acknowledgedAt === null ? null : row.acknowledgedAt.toISOString(),
    institutionName: row.institutionName,
  };
}

function toEvent(row: ContextRow): OperationalEvent {
  return {
    id: row.id,
    kind: row.kind,
    impact: row.impact,
    text: row.text,
    sourceUrl: row.sourceUrl,
    startsAt: row.startsAt === null ? null : row.startsAt.toISOString(),
    endsAt: row.endsAt === null ? null : row.endsAt.toISOString(),
    stopId: row.stopId,
    routeId: row.routeId,
    acknowledgedAt: row.acknowledgedAt === null ? null : row.acknowledgedAt.toISOString(),
  };
}

function toBenchmark(
  resolved: ReturnType<typeof resolveBenchmark>,
): Benchmark {
  if (resolved.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: resolved.reason,
      message: resolved.message,
      considered: resolved.considered,
    };
  }
  return {
    status: 'resolved',
    commitmentId: resolved.commitment.id,
    specificity: resolved.specificity,
    headwayMin: resolved.headwayMin,
    idealWaitMin: resolved.idealWaitMin,
    thresholdMin: resolved.thresholdMin,
    sourceDocumentUrl: resolved.commitment.sourceDocumentUrl,
    sourceDocumentVersion: resolved.commitment.sourceDocumentVersion,
    validFrom: resolved.commitment.validFrom,
    validUntil: resolved.commitment.validUntil,
    message: benchmarkMessage(resolved),
  };
}

function toSnapshot(row: SnapshotRow): AnalysisSnapshot {
  return {
    id: row.id,
    subjectKind: row.subjectKind,
    subjectRef: row.subjectRef,
    methodVersion: row.methodVersion,
    datasetDigest: `sha256:${row.datasetDigest.toString('hex')}`,
    outputDigest: `sha256:${row.outputDigest.toString('hex')}`,
    inputRows: row.inputRows,
    evidenceLevel: row.evidenceLevel as AnalysisSnapshot['evidenceLevel'],
    direction: row.direction as AnalysisSnapshot['direction'],
    warnings: row.warnings,
    computedAt: row.computedAt.toISOString(),
  };
}

function readProvenance(row: SnapshotRow): ProvenanceDocument | null {
  const candidate = row.provenance;
  if (candidate === null || typeof candidate !== 'object') {
    return null;
  }
  const schemaVersion = candidate.schemaVersion;
  if (typeof schemaVersion !== 'number' || schemaVersion < 1) {
    return null;
  }
  return candidate as unknown as ProvenanceDocument;
}

function windowFor(label: '7d' | '30d', now: Date): { start: Date; end: Date } {
  const days = label === '7d' ? 7 : 30;
  const end = new Date(now.getTime());
  const start = new Date(end.getTime() - days * DAY_MS);
  return { start, end };
}

function confidenceWidth(ci: { low: number; high: number } | null): {
  low: number | null;
  high: number | null;
} {
  return ci === null ? { low: null, high: null } : { low: ci.low, high: ci.high };
}

@Injectable()
export class EvidenceService {
  constructor(
    private readonly repository: EvidenceRepository,
    private readonly stops: StopsService,
    private readonly estimates: EstimatesService,
    @Inject(TRANSACTION_RUNNER) private readonly run: TransactionRunner,
  ) {}

  private contextTimeline(rows: readonly ContextRow[], now: Date): ContextTimeline {
    const events = rows.map(toEvent);
    const summary = summariseContext(events, now.toISOString());
    return {
      events: rows.map(toContext),
      segments: summary.segments.map((segment) => ({
        start: segment.start,
        end: segment.end,
        impact: segment.impact,
        eventIds: [...segment.eventIds],
      })),
      dominantImpact: summary.dominantImpact,
      caveats: [...summary.caveats].slice(0, 10),
    };
  }

  async listCommitments(query: CommitmentQuery): Promise<Commitment[]> {
    const rows = await this.repository.listCommitments(db, {
      routeId: query.routeId ?? null,
      stopId: query.stopId ?? null,
      onDate: query.onDate ?? null,
      dayScope: query.dayScope ?? null,
      limit: query.limit,
    });
    return rows.map(toCommitment);
  }

  async commitmentHistory(query: CommitmentHistoryQuery): Promise<
    ReturnType<typeof commitmentChanges>
  > {
    const rows = await this.repository.listCommitments(db, {
      routeId: query.routeId ?? null,
      stopId: query.stopId ?? null,
      onDate: null,
      dayScope: null,
      limit: query.limit,
    });
    const today = new Date().toISOString().slice(0, 10);
    return commitmentChanges(rows.map(toRecord), today);
  }

  async benchmarkFor(
    stopId: string,
    routeId: string | null,
    onDate: string,
    dayScope: CommitmentQuery['dayScope'] | undefined,
  ): Promise<Benchmark> {
    const rows = await this.repository.listCommitments(db, {
      routeId,
      stopId,
      onDate,
      dayScope: dayScope ?? null,
      limit: 50,
    });
    const records = rows.map(toRecord);
    if (dayScope === undefined) {
      return toBenchmark(resolveBenchmarkForStop(records, stopId, routeId, onDate));
    }
    return toBenchmark(
      resolveBenchmark(records, { stopId, routeId, onDate, dayScope }),
    );
  }

  async context(query: ContextQuery): Promise<ContextTimeline> {
    const now = new Date();
    const from =
      query.from === undefined
        ? new Date(now.getTime() - CONTEXT_LOOKBACK_DAYS * DAY_MS)
        : new Date(query.from);
    const to = query.to === undefined ? now : new Date(query.to);
    const rows = await this.repository.listContext(db, {
      stopId: query.stopId ?? null,
      routeId: query.routeId ?? null,
      from,
      to,
      limit: query.limit,
    });
    return this.contextTimeline(rows, now);
  }

  async evidencePack(stopId: string, query: EvidenceQuery): Promise<EvidencePack> {
    const stop = await this.stops.getById(stopId);
    const now = new Date();
    const estimate = await this.estimates.estimate(stopId, {
      window: query.window,
      ...(query.routeId === undefined ? {} : { routeId: query.routeId }),
    });
    const window = windowFor(query.window, now);
    const [commitmentRows, contextRows, snapshot, observations] = await Promise.all([
      this.repository.listCommitments(db, {
        routeId: query.routeId ?? null,
        stopId,
        onDate: now.toISOString().slice(0, 10),
        dayScope: null,
        limit: 50,
      }),
      this.repository.listContext(db, {
        stopId,
        routeId: query.routeId ?? null,
        from: new Date(window.start.getTime() - CONTEXT_LOOKBACK_DAYS * DAY_MS),
        to: now,
        limit: 50,
      }),
      this.repository.findLatestSnapshot(db, 'stop_estimate', stopId),
      this.repository.loadObservationPoints(db, {
        stopId,
        routeId: query.routeId ?? null,
        start: window.start,
        end: window.end,
        includeSimulated: estimate.simulated,
      }),
    ]);

    const benchmark = toBenchmark(
      resolveBenchmarkForStop(
        commitmentRows.map(toRecord),
        stopId,
        query.routeId ?? null,
        now.toISOString().slice(0, 10),
      ),
    );
    const ci = confidenceWidth(estimate.metrics.ci);
    const quality = qualityBreakdown({
      n: estimate.metrics.n,
      clusters: estimate.sample.clusters,
      days: estimate.sample.days,
      hours: new Set(observations.map((row) => row.hour)).size,
      deviceDays: estimate.sample.deviceDays,
      ciLow: ci.low,
      ciHigh: ci.high,
      threshold: estimate.sample.thresholdMin,
      designEffect: estimate.sample.designEffect,
      lowTrustShare: 0,
      sourceAgeDays: 0,
      corroborationCount: 0,
      fieldVerified: estimate.evidence === 'field_verified',
    });
    const representativeness = analyzeRepresentativeness({
      observations: observations.map((row) => ({
        day: row.day,
        hour: row.hour,
        deviceDay: row.deviceDay,
        stopCode: stop.code,
      })),
      daySpanDays: query.window === '7d' ? 7 : 30,
    });
    const annotation = annotateObservations(
      observations.map((row) => ({ at: row.day, day: row.day, hour: row.hour })),
      contextRows.map(toEvent),
      now.toISOString(),
    );

    return {
      stopId: stop.id,
      stopCode: stop.code,
      stopName: stop.name,
      generatedAt: now.toISOString(),
      benchmark,
      quality: {
        dimensions: quality.dimensions.map((dimension) => ({
          dimension: dimension.dimension,
          score: dimension.score,
          band: dimension.band,
          reasons: [...dimension.reasons],
        })) as EvidencePack['quality']['dimensions'],
        limiting: quality.limiting,
        band: quality.band,
        score: quality.score,
        fieldVerifiedEligible: quality.fieldVerifiedEligible,
        warnings: [...quality.warnings],
      },
      representativeness: {
        score: representativeness.score,
        band: representativeness.band,
        limitedTo: representativeness.representativenessLimitedTo,
        warnings: representativeness.warnings.map((warning) => ({
          code: warning.code,
          detail: warning.detail,
        })),
      },
      context: this.contextTimeline(contextRows, now),
      provenance: snapshot === null ? null : readProvenance(snapshot),
      snapshot: snapshot === null ? null : toSnapshot(snapshot),
      disclaimer: this.disclaimer(annotation.annotatedShare),
    };
  }

  private disclaimer(annotatedShare: number): string {
    const base =
      'Angka ini adalah estimasi dari observasi warga, bukan jadwal resmi. ' +
      'Tidak ada observasi yang dihapus; konteks operasional hanya menjelaskan.';
    if (annotatedShare <= 0) {
      return base;
    }
    return `${base} Sebanyak ${Math.round(annotatedShare * 100)}% pengamatan berada dalam periode yang dijelaskan pengumuman.`;
  }

  async createCommitment(
    adminId: string,
    input: CommitmentCreate,
  ): Promise<Commitment> {
    return this.run(
      async (tx) => {
        const created = await this.repository.createCommitment(tx, {
          institutionId: input.institutionId,
          routeId: input.routeId ?? null,
          stopId: input.stopId ?? null,
          kind: input.kind,
          dayScope: input.dayScope,
          headwayMin: input.headwayMin ?? null,
          spanStart: input.spanStart ?? null,
          spanEnd: input.spanEnd ?? null,
          sourceDocumentUrl: input.sourceDocumentUrl,
          sourceDocumentTitle: input.sourceDocumentTitle ?? null,
          sourceDocumentVersion: input.sourceDocumentVersion ?? null,
          validFrom: input.validFrom,
          validUntil: input.validUntil ?? null,
          notes: input.notes ?? null,
        });
        void adminId;
        return toCommitment(created);
      },
      { scope: 'admin', userId: adminId },
    );
  }

  async verifyCommitment(adminId: string, id: string): Promise<Commitment> {
    return this.run(
      async (tx) => {
        const updated = await this.repository.verifyCommitment(tx, id, adminId);
        if (updated === null) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Janji layanan tidak ditemukan atau bukan berstatus draf.',
          });
        }
        return toCommitment(updated);
      },
      { scope: 'admin', userId: adminId },
    );
  }

  async revokeCommitment(
    adminId: string,
    id: string,
    reason: string,
  ): Promise<Commitment> {
    return this.run(
      async (tx) => {
        const updated = await this.repository.revokeCommitment(tx, id, reason);
        if (updated === null) {
          throw new AppError('INVALID_TRANSITION', {
            detail: 'Janji layanan tidak ditemukan atau sudah dicabut.',
          });
        }
        return toCommitment(updated);
      },
      { scope: 'admin', userId: adminId },
    );
  }

  async createIncident(input: IncidentCreate): Promise<{ id: string }> {
    return this.run(async (tx) => {
      const id = await this.repository.createIncident(tx, {
        kind: input.kind,
        impact: input.impact,
        text: input.text,
        sourceUrl: input.sourceUrl,
        stopId: input.stopId ?? null,
        routeId: input.routeId ?? null,
        cityId: input.cityId ?? null,
        startsAt: input.startsAt == null ? null : new Date(input.startsAt),
        endsAt: input.endsAt == null ? null : new Date(input.endsAt),
        publicVisible: input.publicVisible,
      });
      return { id };
    });
  }

  async acknowledgeIncident(
    institutionId: string,
    noticeId: string,
  ): Promise<{ acknowledged: boolean }> {
    return this.run(
      async (tx) => {
        const acknowledged = await this.repository.acknowledgeIncident(
          tx,
          noticeId,
          institutionId,
        );
        return { acknowledged };
      },
      { scope: 'partner', institutionId },
    );
  }

  async verifySnapshot(
    snapshotId: string,
    candidate: {
      methodVersion: string;
      datasetDigest: string;
      outputDigest: string;
      inputRows: number;
    },
  ): Promise<ReturnType<typeof verifyReproducibility>> {
    const snapshot = await this.repository.findSnapshotById(db, snapshotId);
    if (snapshot === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Rekaman analisis tidak ditemukan.',
      });
    }
    return verifyReproducibility(
      {
        methodVersion: snapshot.methodVersion,
        parameters: {},
        datasetDigest: `sha256:${snapshot.datasetDigest.toString('hex')}`,
        outputDigest: `sha256:${snapshot.outputDigest.toString('hex')}`,
        inputRows: snapshot.inputRows,
        window: {
          start: snapshot.computedAt.toISOString(),
          end: snapshot.computedAt.toISOString(),
        },
        steps: [],
        caveats: [],
      },
      candidate,
    );
  }

  describeCommitmentRow(row: CommitmentRow): string {
    return describeCommitment(toRecord(row));
  }
}
