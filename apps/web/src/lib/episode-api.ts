import type {
  AccuracyBucket,
  DistanceBucket,
  EndEpisodeInput,
  Episode,
  EpisodeOutcome,
  Presence,
  QrProof,
  StartEpisodeInput,
  StartMode,
} from '@hadir/contracts';
import { apiRequest, apiSendChecked, hasDevice, isApiError, type PayloadSchema } from './api';
import { isRecord, readCount, readIsoDateTime, readNullableText, readNumber, readText } from './guards';

const EPISODE_PATH = '/v1/episodes';
const MAX_FLAGS = 20;

const START_MODES: readonly StartMode[] = ['qr', 'gps_nearby', 'manual', 'resume', 'import'];
const PRESENCES: readonly Presence[] = [
  'unverified',
  'qr_only',
  'qr_geo',
  'gps_verified',
  'field_verified',
];
const OUTCOMES: readonly EpisodeOutcome[] = [
  'boarded',
  'abandoned',
  'passed_full',
  'cancelled',
  'timeout',
];

function pick<T extends string>(values: readonly T[], raw: unknown): T | null {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

function toEpisode(value: unknown): Episode | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = readText(value.id, 64);
  const stopId = readText(value.stopId, 64);
  const stopCode = readText(value.stopCode, 12);
  const stopName = readText(value.stopName, 160);
  const routeId = readNullableText(value.routeId, 64);
  const startMode = pick(START_MODES, value.startMode);
  const presence = pick(PRESENCES, value.presence);
  const trustWeight = readNumber(value.trustWeight);
  const startedAt = readIsoDateTime(value.startedAt);
  const status = value.status;
  const flags = value.qualityFlags;

  if (id === null || stopId === null || stopCode === null || stopName === null) {
    return null;
  }
  if (routeId === undefined || startMode === null || presence === null) {
    return null;
  }
  if (trustWeight === null || trustWeight < 0 || trustWeight > 1) {
    return null;
  }
  if (startedAt === null) {
    return null;
  }
  if (status !== 'active' && status !== 'ended') {
    return null;
  }
  if (!Array.isArray(flags) || flags.length > MAX_FLAGS) {
    return null;
  }
  const qualityFlags: string[] = [];
  for (const flag of flags) {
    const text = readText(flag, 64);
    if (text === null) {
      return null;
    }
    qualityFlags.push(text);
  }

  const endedAtRaw = value.endedAt;
  const endedAt = endedAtRaw === null ? null : readIsoDateTime(endedAtRaw);
  const durationRaw = value.durationS;
  const durationS = durationRaw === null ? null : readCount(durationRaw, 86_400);
  const outcomeRaw = value.outcome;
  const outcome = outcomeRaw === null ? null : pick(OUTCOMES, outcomeRaw);

  if (endedAtRaw !== null && endedAt === null) {
    return null;
  }
  if (durationRaw !== null && durationS === null) {
    return null;
  }
  if (outcomeRaw !== null && outcome === null) {
    return null;
  }

  return {
    id,
    stopId,
    stopCode,
    stopName,
    routeId,
    startMode,
    presence,
    trustWeight,
    startedAt,
    endedAt,
    status,
    durationS,
    outcome,
    qualityFlags,
  };
}

export const episodeSchema: PayloadSchema<Episode> = {
  safeParse(value) {
    const episode = toEpisode(value);
    return episode === null ? { success: false } : { success: true, data: episode };
  },
};

export const nullableEpisodeSchema: PayloadSchema<Episode | null> = {
  safeParse(value) {
    if (value === null) {
      return { success: true, data: null };
    }
    const episode = toEpisode(value);
    return episode === null ? { success: false } : { success: true, data: episode };
  },
};

export interface EpisodeSnapshot {
  episode: Episode;
  serverNow: string | null;
}

export interface ActiveEpisodeSnapshot {
  episode: Episode | null;
  serverNow: string | null;
}

export function episodeQueryKey(episodeId: string) {
  return ['episode', episodeId] as const;
}

export function activeEpisodeQueryKey() {
  return ['episode', 'active'] as const;
}

export async function fetchEpisode(episodeId: string): Promise<EpisodeSnapshot> {
  const envelope = await apiSendChecked(`${EPISODE_PATH}/${episodeId}`, episodeSchema, {
    method: 'GET',
  });
  return { episode: envelope.data, serverNow: envelope.meta.generatedAt };
}

export async function fetchActiveEpisode(): Promise<ActiveEpisodeSnapshot> {
  if (!hasDevice()) {
    return { episode: null, serverNow: null };
  }
  try {
    const envelope = await apiSendChecked(`${EPISODE_PATH}/active`, nullableEpisodeSchema, {
      method: 'GET',
    });
    return { episode: envelope.data, serverNow: envelope.meta.generatedAt };
  } catch (error) {
    if (isApiError(error) && error.code === 'UNAUTHENTICATED') {
      return { episode: null, serverNow: null };
    }
    throw error;
  }
}

export interface StartRequest {
  stopCode: string;
  routeId: string | null;
  startMode: StartMode;
  qr: QrProof | null;
  distanceBucket: DistanceBucket | null;
  accuracyBucket: AccuracyBucket | null;
}

export interface StartAttempt {
  clientStartedAt: string;
  clientEventId: string;
}

export async function startEpisode(
  request: StartRequest,
  attempt: StartAttempt,
  idempotencyKey: string,
): Promise<Episode> {
  const body: StartEpisodeInput = {
    stopCode: request.stopCode,
    routeId: request.routeId,
    startMode: request.startMode,
    clientStartedAt: attempt.clientStartedAt,
    clientEventId: attempt.clientEventId,
    ...(request.qr === null ? {} : { qr: request.qr }),
    ...(request.distanceBucket === null ? {} : { distanceBucket: request.distanceBucket }),
    ...(request.accuracyBucket === null ? {} : { accuracyBucket: request.accuracyBucket }),
  };
  const envelope = await apiSendChecked(EPISODE_PATH, episodeSchema, {
    method: 'POST',
    body,
    idempotencyKey,
  });
  return envelope.data;
}

export interface EndAttempt {
  clientEndedAt: string;
  clientEventId: string;
}

export async function endEpisode(
  episodeId: string,
  outcome: EndEpisodeInput['outcome'],
  attempt: EndAttempt,
  idempotencyKey: string,
): Promise<Episode> {
  const body: EndEpisodeInput = {
    outcome,
    clientEndedAt: attempt.clientEndedAt,
    clientEventId: attempt.clientEventId,
  };
  const envelope = await apiSendChecked(`${EPISODE_PATH}/${episodeId}`, episodeSchema, {
    method: 'PATCH',
    body,
    idempotencyKey,
  });
  return envelope.data;
}

export async function sendHeartbeat(
  episodeId: string,
  clientEventId: string,
  keepalive: boolean,
): Promise<void> {
  await apiRequest<void>(`${EPISODE_PATH}/${episodeId}/heartbeat`, {
    method: 'POST',
    body: { clientEventId, clientAt: new Date().toISOString() },
    keepalive,
    timeoutMs: 5_000,
  });
}