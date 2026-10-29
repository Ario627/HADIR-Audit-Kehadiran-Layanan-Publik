import { isApiError } from './api';
import { endEpisode } from './episode-api';
import { announceOutbox, isDue, shouldAbandon, type OutboxEntry } from './outbox';
import { isPermanentCode, penalizeEntry } from './outbox-queue';
import { readOutbox, writeOutbox } from './outbox-store';
import { submitReport } from './report-api';

export interface FlushResult {
  sent: number;
  retried: number;
  dropped: number;
}

let inflight: Promise<FlushResult> | null = null;

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine;
}

async function executeEntry(entry: OutboxEntry): Promise<void> {
  if (entry.kind === 'episode.end') {
    await endEpisode(
      entry.targetId,
      entry.body.outcome,
      {
        clientEndedAt: entry.body.clientEndedAt,
        clientEventId: entry.body.clientEventId,
      },
      entry.idempotencyKey,
    );
    return;
  }
  const { category, stopCode, text, triageSessionId, clientEventId } = entry.body;
  await submitReport(
    {
      stopCode,
      category,
      text,
      ...(triageSessionId === null ? {} : { triageSessionId }),
    },
    { clientEventId },
    entry.idempotencyKey,
  );
}

async function runFlush(now: number, jitter: number): Promise<FlushResult> {
  const entries = await readOutbox(now);
  if (entries.length === 0) {
    return { sent: 0, retried: 0, dropped: 0 };
  }

  const survivors: OutboxEntry[] = [];
  let sent = 0;
  let retried = 0;
  let dropped = 0;

  for (const entry of entries) {
    if (shouldAbandon(entry, now)) {
      dropped += 1;
      continue;
    }
    if (!isDue(entry, now)) {
      survivors.push(entry);
      continue;
    }
    try {
      await executeEntry(entry);
      sent += 1;
    } catch (error) {
      const code = isApiError(error) ? error.code : 'UNKNOWN';
      if (isPermanentCode(code)) {
        dropped += 1;
        continue;
      }
      survivors.push(penalizeEntry(entry, code, now, jitter));
      retried += 1;
    }
  }

  await writeOutbox(survivors);
  return { sent, retried, dropped };
}

export async function flushOutbox(
  options: { now?: number; jitter?: number; force?: boolean } = {},
): Promise<FlushResult> {
  if (!isOnline() && options.force !== true) {
    return { sent: 0, retried: 0, dropped: 0 };
  }
  inflight ??= (async () => {
    try {
      const result = await runFlush(options.now ?? Date.now(), options.jitter ?? Math.random());
      if (result.sent > 0 || result.dropped > 0) {
        announceOutbox();
      }
      return result;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}