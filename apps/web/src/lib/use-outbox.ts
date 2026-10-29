import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  OUTBOX_EVENT,
  findForDraft,
  findForEpisode,
  type OutboxEndEntry,
  type OutboxReportEntry,
} from './outbox';
import { readOutbox } from './outbox-store';

const POLL_MS = 30_000;

export function useOutboxSync(): { pending: number } {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    const entries = await readOutbox();
    setPending(entries.length);
  }, []);

  const run = useCallback(async (): Promise<void> => {
    const entries = await readOutbox();
    setPending(entries.length);
    if (entries.length === 0) {
      return;
    }
    const { flushOutbox } = await import('./outbox-sync');
    const result = await flushOutbox();
    await refresh();
    if (result.sent > 0) {
      await queryClient.invalidateQueries({ queryKey: ['episode'] });
      await queryClient.invalidateQueries({ queryKey: ['reports'] });
      await queryClient.invalidateQueries({ queryKey: ['report'] });
    }
  }, [queryClient, refresh]);

  useEffect(() => {
    void run();
    const onOnline = (): void => {
      void run();
    };
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') {
        void run();
      }
    };
    const onOutbox = (): void => {
      void refresh();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener(OUTBOX_EVENT, onOutbox);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      void readOutbox().then((entries) => {
        setPending(entries.length);
        if (entries.length > 0) {
          void run();
        }
      });
    }, POLL_MS);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener(OUTBOX_EVENT, onOutbox);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [refresh, run]);

  return { pending };
}

export function useQueuedEnd(episodeId: string): OutboxEndEntry | null {
  const [entry, setEntry] = useState<OutboxEndEntry | null>(null);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void readOutbox().then((entries) => {
        if (alive) {
          setEntry(findForEpisode(entries, episodeId));
        }
      });
    };
    load();
    window.addEventListener(OUTBOX_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(OUTBOX_EVENT, load);
    };
  }, [episodeId]);

  return entry;
}

export function useQueuedReport(draftId: string): OutboxReportEntry | null {
  const [entry, setEntry] = useState<OutboxReportEntry | null>(null);

  useEffect(() => {
    let alive = true;
    const load = (): void => {
      void readOutbox().then((entries) => {
        if (alive) {
          setEntry(findForDraft(entries, draftId));
        }
      });
    };
    load();
    window.addEventListener(OUTBOX_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(OUTBOX_EVENT, load);
    };
  }, [draftId]);

  return entry;
}