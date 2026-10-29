import { useCallback, useEffect, useRef } from 'react';
import {
  CROSS_TAB_CHANNEL,
  affectsEpisode,
  decodeCrossTab,
  readResumeMark,
  sessionStore,
  shouldResume,
  waitPath,
  writeResumeMark,
} from './resume';

export function useResumeRedirect(
  activeEpisodeId: string | null,
  currentPath: string,
  onResume: (episodeId: string) => void,
): void {
  const done = useRef(false);

  useEffect(() => {
    if (done.current || activeEpisodeId === null) {
      return;
    }
    done.current = true;
    const store = sessionStore();
    const decision = shouldResume({
      activeEpisodeId,
      alreadyResumed: readResumeMark(store, activeEpisodeId),
      currentPath,
    });
    if (decision !== 'resume') {
      return;
    }
    writeResumeMark(store, activeEpisodeId);
    onResume(activeEpisodeId);
  }, [activeEpisodeId, currentPath, onResume]);
}

export interface CrossTabOptions {
  watchedId: string | null;
  onChanged: (episodeId: string | null) => void;
}

export function useCrossTabEpisode({ watchedId, onChanged }: CrossTabOptions): void {
  const handle = useCallback(
    (raw: unknown) => {
      const message = decodeCrossTab(raw);
      if (message === null) {
        return;
      }
      if (watchedId !== null && !affectsEpisode(message, watchedId)) {
        return;
      }
      onChanged(message.episodeId);
    },
    [watchedId, onChanged],
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel === 'function') {
        channel = new BroadcastChannel(CROSS_TAB_CHANNEL);
        channel.onmessage = (event: MessageEvent<unknown>) => {
          handle(event.data);
        };
      }
    } catch {
      channel = null;
    }

    const onStorage = (event: StorageEvent) => {
      if (event.key === null || !event.key.startsWith('hadir.')) {
        return;
      }
      onChanged(null);
    };

    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('storage', onStorage);
      if (channel !== null) {
        channel.close();
      }
    };
  }, [handle, onChanged]);
}

export { waitPath };