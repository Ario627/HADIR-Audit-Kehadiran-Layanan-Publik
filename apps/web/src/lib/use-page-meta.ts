import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { descriptionFor, documentTitle, pageMetaFor, robotsDirective } from './page-meta';

function upsertMeta(name: string, content: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const existing = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (existing !== null) {
    existing.content = content;
    return;
  }
  const created = document.createElement('meta');
  created.name = name;
  created.content = content;
  document.head.append(created);
}

export function usePageMeta(): void {
  const fullPath = useRouterState({
    select: (state) => state.matches[state.matches.length - 1]?.fullPath ?? null,
  });

  useEffect(() => {
    const meta = pageMetaFor(fullPath);
    if (typeof document !== 'undefined') {
      document.title = documentTitle(meta);
    }
    upsertMeta('robots', robotsDirective(meta === null ? true : meta.noindex));
    upsertMeta('description', descriptionFor(meta));
  }, [fullPath]);
}