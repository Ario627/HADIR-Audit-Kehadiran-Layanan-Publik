import { useEffect } from 'react';
import { useRouterState } from '@tanstack/react-router';
import { descriptionFor, documentTitle, resolvePageMeta, robotsDirective } from './page-meta';

const FIELD_SEPARATOR = '|';
const ROOT_ONLY_MATCHES = 1;

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
  const key = useRouterState({
    select: (state) => {
      const last = state.matches[state.matches.length - 1];
      return `${state.matches.length}${FIELD_SEPARATOR}${last?.fullPath ?? ''}`;
    },
  });

  useEffect(() => {
    const separator = key.indexOf(FIELD_SEPARATOR);
    const count = separator === -1 ? 0 : Number(key.slice(0, separator));
    const fullPath = separator === -1 ? '' : key.slice(separator + 1);
    const meta = resolvePageMeta(fullPath, count <= ROOT_ONLY_MATCHES);
    if (typeof document !== 'undefined') {
      document.title = documentTitle(meta);
    }
    upsertMeta('robots', robotsDirective(meta === null ? true : meta.noindex));
    upsertMeta('description', descriptionFor(meta));
  }, [key]);
}