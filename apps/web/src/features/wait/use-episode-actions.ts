import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { isApiError } from '../../lib/api';
import { endEpisode, sendHeartbeat, startEpisode, type StartRequest } from '../../lib/episode-api';
import type { EndOutcome } from '../../lib/episode';
import { isUuid, uuidv7 } from '../../lib/id';

const HEARTBEAT_INTERVAL_MS = 60_000;
const HEARTBEAT_MIN_GAP_MS = 35_000;
const CLOSED_CODES = new Set(['INVALID_TRANSITION', 'NOT_FOUND']);

interface Attempt {
  signature: string;
  idempotencyKey: string;
  clientEventId: string;
  clientAt: string;
}

function attemptFor(holder: { current: Attempt | null }, signature: string): Attempt {
  const current = holder.current;
  if (current !== null && current.signature === signature) {
    return current;
  }
  const next: Attempt = {
    signature,
    idempotencyKey: uuidv7(),
    clientEventId: uuidv7(),
    clientAt: new Date().toISOString(),
  };
  holder.current = next;
  return next;
}

function startSignature(request: StartRequest): string {
  const route = request.routeId === null ? '' : request.routeId;
  const signature = request.qr === null ? '' : request.qr.signature;
  return `${request.stopCode}|${route}|${request.startMode}|${signature}`;
}

export function useStartEpisode() {
  const holder = useRef<Attempt | null>(null);
  return useMutation({
    mutationFn: (request: StartRequest) => {
      const attempt = attemptFor(holder, startSignature(request));
      return startEpisode(
        request,
        { clientStartedAt: attempt.clientAt, clientEventId: attempt.clientEventId },
        attempt.idempotencyKey,
      );
    },
    retry: 0,
  });
}

export function useEndEpisode(episodeId: string) {
  const holder = useRef<Attempt | null>(null);
  return useMutation({
    mutationFn: (outcome: EndOutcome) => {
      const attempt = attemptFor(holder, outcome);
      return endEpisode(
        episodeId,
        outcome,
        { clientEndedAt: attempt.clientAt, clientEventId: attempt.clientEventId },
        attempt.idempotencyKey,
      );
    },
    retry: 0,
  });
}

export function useHeartbeat(episodeId: string, active: boolean): void {
  const queryClient = useQueryClient();
  const validId = isUuid(episodeId);

  useEffect(() => {
    if (!active || !validId) {
      return;
    }
    let lastAt = 0;

    const beat = (keepalive: boolean): void => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return;
      }
      const now = Date.now();
      if (now - lastAt < HEARTBEAT_MIN_GAP_MS) {
        return;
      }
      lastAt = now;
      void sendHeartbeat(episodeId, uuidv7(), keepalive).catch((error: unknown) => {
        if (isApiError(error) && CLOSED_CODES.has(error.code)) {
          void queryClient.invalidateQueries({ queryKey: ['episode', episodeId] });
        }
      });
    };

    beat(true);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        beat(false);
      }
    }, HEARTBEAT_INTERVAL_MS);

    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        beat(true);
      }
    };
    const onPageHide = (): void => {
      beat(true);
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [active, episodeId, queryClient, validId]);
}