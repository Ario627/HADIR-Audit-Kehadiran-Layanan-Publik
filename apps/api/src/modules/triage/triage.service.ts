import { Injectable, Logger } from '@nestjs/common';
import type {
  Estimate,
  ReportCategory,
  TriageAction,
  TriageEvidence,
  TriageInput,
  TriageResult,
  TriageRules,
  TriageSessionView,
} from '@hadir/contracts';
import {
  decideTriage,
  possibleMatch,
  triageCriteria,
  type ConnectorState,
  type EvidenceRef,
  type TriageActionKind,
  type TriageFacts,
  type TriageVerdict,
} from '@hadir/domain';
import { AppError } from '../../common/errors/app-error';
import { idempotencyHash } from '../../common/http/idempotency-key';
import type { DeviceIdentity } from '../../common/http/request-context';
import {
  IdempotencyService,
  type IdempotencyContext,
} from '../../common/idempotency/idempotency.service';
import { DevicesRepository } from '../../db/repositories/devices.repository';
import {
  TriageRepository,
  type EvidenceRow,
} from '../../db/repositories/triage.repository';
import type { Transaction } from '../../db/client';
import { EstimatesService } from '../estimates/estimates.service';
import { RunwayService } from '../runway/runway.service';import { StopsService } from '../stops/stops.service';
import { copyFor } from './triage.messages';

const RULES_VERSION = 'triage-v1';
const DUPLICATE_WINDOW_DAYS = 60;
const DUPLICATE_RADIUS_M = 75;
const ESTIMATE_WINDOW = '7d' as const;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const EVIDENCE_LIMIT = 20;

const SERVICE_CATEGORIES: ReadonlySet<ReportCategory> = new Set<ReportCategory>([
  'service_wait',
  'service_no_show',
  'service_full',
]);

const ACTION_LABELS: Record<TriageActionKind, string> = {
  join: 'Gabung ke laporan yang ada',
  monitor: 'Pantau dan ingatkan',
  send_elsewhere: 'Kirim ke instansi yang tepat',
  measure: 'Bantu ukur lama tunggu',
  send_anyway: 'Tetap kirim laporan',
  open_radar: 'Lihat radar keberlanjutan',
};

const VERDICT_HEADLINES: Record<TriageVerdict, string> = {
  join: 'Laporan serupa sudah ada',
  already_planned: 'Sudah ada rencana resmi',
  wrong_authority: 'Bukan kewenangan instansi ini',
  service_not_running: 'Layanan tidak berjalan',
  data_supports: 'Pengukuran warga mendukung',
  data_insufficient: 'Data belum cukup',
  new_report: 'Laporan baru',
};

interface Attempt<T> {
  available: boolean;
  value: T | null;
}
export function assertKnownDevice(device: DeviceIdentity): void {
  if (device.isNew) {
    throw new AppError('UNAUTHENTICATED', {
      detail: 'Panggil POST /v1/devices sebelum melakukan triase.',
    });
  }
}

export function connectorState(attempt: Attempt<unknown>): ConnectorState {
  return attempt.available ? 'ok' : 'unavailable';
}

export function toEvidence(row: EvidenceRow): TriageEvidence {
  const ref: EvidenceRef = {
    id: row.id,
    tier: row.tier,
    matchScore: row.matchScore,
  };
  return {
    id: row.id,
    claim: row.claim,
    tier: row.tier,
    sourceUrl: row.sourceUrl,
    retrievedAt: row.retrievedAt.toISOString(),
    matchScore: row.matchScore,
    label: possibleMatch(ref) ? 'mungkin terkait' : 'terkait',
  };
}

export function toAction(kind: TriageActionKind): TriageAction {
  return { kind, label: ACTION_LABELS[kind] };
}

export function estimateSignal(estimate: Estimate | null): TriageFacts['estimate'] {
  if (estimate === null) {
    return null;
  }
  return {
    level: estimate.evidence,
    direction: estimate.direction,
    n: estimate.metrics.n,
  };
}

export function serviceRunningFrom(
  available: boolean,
  status: string | null,
): boolean | null {
  if (!available || status === null) {
    return null;
  }
  if (status === 'stopped') {
    return false;
  }
  if (status === 'funded') {
    return true;
  }
  return null;
}

export type RadarAttempt =
  | { kind: 'not_applicable' }
  | { kind: 'unavailable' }
  | { kind: 'ok'; status: string | null };

export function radarState(attempt: RadarAttempt): 'ok' | 'unavailable' | 'not_configured' {
  if (attempt.kind === 'not_applicable') {
    return 'not_configured';
  }
  if (attempt.kind === 'unavailable') {
    return 'unavailable';
  }
  return 'ok';
}

export function radarAvailable(attempt: RadarAttempt): boolean {
  return attempt.kind === 'ok';
}

export function radarServiceRunning(attempt: RadarAttempt): boolean | null {
  return attempt.kind === 'ok'
    ? serviceRunningFrom(true, attempt.status)
    : null;
}

@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly repository: TriageRepository,
    private readonly devices: DevicesRepository,
    private readonly stops: StopsService,
    private readonly estimates: EstimatesService,
    private readonly runway: RunwayService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async collect<T>(label: string, run: () => Promise<T>): Promise<Attempt<T>> {
    try {
      return { available: true, value: await run() };
    } catch (error) {
      this.logger.warn(
        `Fakta triase "${label}" gagal dimuat: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { available: false, value: null };
    }
  }

  private async assertDeviceRecord(tx: Transaction, deviceHash: string): Promise<void> {
    const record = await this.devices.findByHash(tx, deviceHash);
    if (record === null) {
      throw new AppError('UNAUTHENTICATED', { detail: 'Perangkat belum terdaftar.' });
    }
    if (record.revokedAt !== null) {
      throw new AppError('FORBIDDEN', { detail: 'Perangkat ini diblokir.' });
    }
  }

  private async collectFacts(
    stopId: string,
    stopCode: string,
    category: ReportCategory,
    routeId: string | null,
  ): Promise<TriageFacts> {
    const [duplicates, planned, authority, pilot, estimate, radar] = await Promise.all([
      this.collect('duplicates', () =>
        this.repository.countDuplicates(stopId, category, DUPLICATE_WINDOW_DAYS),
      ),
      this.collect('planned', () =>
        this.repository.findPlannedEvidence(stopCode, category, routeId),
      ),
      this.collect('authority', () => this.repository.findAuthority(stopId)),
      this.collect('pilot', () => this.repository.findPilotInstitution(stopId)),
      this.collect('estimate', () =>
        this.estimates.estimate(
          stopId,
          routeId === null
            ? { window: ESTIMATE_WINDOW }
            : { window: ESTIMATE_WINDOW, routeId },
        ),
      ),
      routeId === null
        ? Promise.resolve<RadarAttempt>({ kind: 'not_applicable' })
        : this.collect('runway', () => this.runway.statusFor(routeId)).then(
            (attempt): RadarAttempt =>
              attempt.available
                ? { kind: 'ok', status: attempt.value }
                : { kind: 'unavailable' },
          ),
    ]);

    return {
      duplicateCount: duplicates.value ?? 0,
      duplicatesAvailable: duplicates.available,
      planned: planned.value ?? [],
      plannedAvailable: planned.available,
      authority: authority.value,
      authorityAvailable: authority.available,
      pilotInstitutionId: pilot.value,
      serviceRunning: radarServiceRunning(radar),
      radarAvailable: radarAvailable(radar),
      estimate: estimateSignal(estimate.value),
      categoryIsService: SERVICE_CATEGORIES.has(category),
      connectors: {
        duplicates: connectorState(duplicates),
        planned: connectorState(planned),
        authority: connectorState(authority),
        estimate: connectorState(estimate),
        radar: radarState(radar),
      },
    };
  }

  async triage(
    input: TriageInput,
    key: string,
    device: DeviceIdentity,
    context: IdempotencyContext,
  ): Promise<TriageResult> {
    assertKnownDevice(device);

    const stop = await this.stops.getByCode(input.stopCode);
    if (stop.status !== 'active') {
      throw new AppError('STOP_INACTIVE', { detail: 'Halte sedang tidak aktif.' });
    }
    const routeId = input.routeId ?? null;
    if (routeId !== null) {
      const route = stop.routes.find((item) => item.id === routeId);
      if (route === undefined) {
        throw new AppError('VALIDATION_FAILED', {
          detail: 'Koridor tidak melayani halte ini.',
          errors: [
            {
              field: 'routeId',
              code: 'route_mismatch',
              message: 'routeId tidak terhubung ke halte ini.',
            },
          ],
        });
      }
    }

    const requestHash = idempotencyHash({
      stopCode: input.stopCode,
      routeId,
      category: input.category,
      clientEventId: input.clientEventId,
      text: input.text ?? null,
    });

    const result = await this.idempotency.execute(
      {
        scope: `triage.${device.hash}`,
        key,
        requestHash,
        ttlMs: IDEMPOTENCY_TTL_MS,
      },
      async (tx) => {
        await this.assertDeviceRecord(tx, device.hash);
        const startedAt = Date.now();
        const facts = await this.collectFacts(stop.id, stop.code, input.category, routeId);
        const decision = decideTriage(facts);
        const latencyMs = Date.now() - startedAt;
        const evidence = (facts.planned as EvidenceRow[]).slice(0, EVIDENCE_LIMIT);
        const session = await this.repository.insertSession(tx, {
          deviceHash: device.hash,
          deviceDayHash: device.dayHash,
          clientEventId: input.clientEventId,
          stopId: stop.id,
          routeId,
          category: input.category,
          verdict: decision.verdict,
          evidenceIds: [...decision.citedEvidenceIds],
          rulesVer: RULES_VERSION,
          latencyMs,
          connectors: facts.connectors,
        });
        const copy = copyFor(decision.verdict);
        const body: TriageResult = {
          sessionId: session.id,
          verdict: decision.verdict,
          headline: copy.headline,
          body: copy.body,
          actions: decision.actions.map(toAction),
          evidence: evidence.map(toEvidence),
          connectors: facts.connectors,
          rulesVersion: RULES_VERSION,
          latencyMs,
          reasons: [...decision.reasons],
          requiresConfirmation: decision.requiresHumanConfirmation,
        };
        return { status: 200, body };
      },
      context,
    );

    return result.body as TriageResult;
  }

  async getSession(id: string, device: DeviceIdentity): Promise<TriageSessionView> {
    assertKnownDevice(device);
    const session = await this.repository.findSessionForDevice(id, device.hash);
    if (session === null) {
      throw new AppError('NOT_FOUND', { detail: 'Sesi triase tidak ditemukan.' });
    }
    return {
      sessionId: session.id,
      verdict: session.verdict as TriageSessionView['verdict'],
      connectors: session.connectors as TriageSessionView['connectors'],
      latencyMs: session.latencyMs,
      createdAt: session.createdAt.toISOString(),
    };
  }

  rules(): TriageRules {
    const criteria = triageCriteria();
    return {
      rulesVersion: RULES_VERSION,
      verdicts: (Object.keys(VERDICT_HEADLINES) as TriageVerdict[]).map((verdict) => ({
        verdict,
        headline: VERDICT_HEADLINES[verdict],
        description: copyFor(verdict).body,
      })),
      thresholds: {
        minSample: criteria.minN,
        possibleMatch: criteria.possibleMatch,
        duplicateRadiusM: DUPLICATE_RADIUS_M,
        duplicateWindowDays: DUPLICATE_WINDOW_DAYS,
      },
      alwaysAvailableAction: 'send_anyway',
    };
  }
}
