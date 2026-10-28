import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TITLE,
  KNOWN_PATHS,
  MAX_DESCRIPTION,
  MAX_TITLE,
  descriptionFor,
  documentTitle,
  isProtectedPath,
  pageMetaFor,
  robotsDirective,
} from './page-meta';

const tree = import.meta.glob('../routeTree.gen.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function fullPathsFromTree(): string[] {
  const source = Object.values(tree)[0] ?? '';
  const block = source.slice(source.indexOf('fullPaths:'));
  const end = block.indexOf('fileRoutesByTo');
  const segment = end === -1 ? block : block.slice(0, end);
  const paths: string[] = [];
  for (const match of segment.matchAll(/'(\/[^']*)'/g)) {
    paths.push(match[1] as string);
  }
  return paths;
}

describe('pageMetaFor', () => {
  it('resolves every route declared by the generated tree', () => {
    const paths = fullPathsFromTree();
    expect(paths.length).toBeGreaterThan(20);
    const missing = paths.filter((path) => pageMetaFor(path) === null);
    expect(missing).toEqual([]);
  });

  it('ignores a trailing slash', () => {
    expect(pageMetaFor('/partner/')?.title).toBe(pageMetaFor('/partner')?.title);
    expect(pageMetaFor('/transparansi/')?.title).toBe(pageMetaFor('/transparansi')?.title);
  });

  it('returns null for an unknown path', () => {
    expect(pageMetaFor('/tidak-ada')).toBeNull();
    expect(pageMetaFor('')).toBeNull();
    expect(pageMetaFor(null)).toBeNull();
    expect(pageMetaFor(undefined)).toBeNull();
  });

  it('marks every partner surface as noindex', () => {
    const partnerPaths = KNOWN_PATHS.filter((path) => isProtectedPath(path));
    expect(partnerPaths.length).toBeGreaterThan(5);
    for (const path of partnerPaths) {
      expect(pageMetaFor(path)?.noindex).toBe(true);
    }
  });

  it('marks device-scoped pages as noindex', () => {
    expect(pageMetaFor('/wait/$episodeId')?.noindex).toBe(true);
    expect(pageMetaFor('/ringkasan/$episodeId')?.noindex).toBe(true);
  });

  it('keeps public content indexable', () => {
    for (const path of ['/', '/peta', '/metodologi', '/transparansi/', '/laporan/$publicId']) {
      expect(pageMetaFor(path)?.noindex).toBe(false);
    }
  });

  it('describes never claiming a report is verified', () => {
    const description = pageMetaFor('/laporan/$publicId')?.description ?? '';
    expect(description).toContain('Catatan internal');
  });
});

describe('documentTitle', () => {
  it('composes a page title with the site name', () => {
    expect(documentTitle(pageMetaFor('/'))).toBe('Papan bukti tunggu bus · HADIR');
  });

  it('falls back to the default for an unknown route', () => {
    expect(documentTitle(null)).toBe(DEFAULT_TITLE);
  });

  it('never exceeds the display budget', () => {
    for (const path of KNOWN_PATHS) {
      expect(documentTitle(pageMetaFor(path)).length).toBeLessThanOrEqual(MAX_TITLE);
    }
  });
});

describe('robotsDirective', () => {
  it('maps the two states', () => {
    expect(robotsDirective(false)).toBe('index, follow');
    expect(robotsDirective(true)).toBe('noindex, nofollow');
  });

  it('never emits a bare noindex without nofollow', () => {
    expect(robotsDirective(true)).toContain('nofollow');
  });
});

describe('descriptionFor', () => {
  it('returns the page description', () => {
    expect(descriptionFor(pageMetaFor('/metodologi'))).toContain('Definisi metrik');
  });

  it('falls back to the site default', () => {
    expect(descriptionFor(null)).toBe(DEFAULT_TITLE);
  });

  it('collapses whitespace and caps the length', () => {
    for (const path of KNOWN_PATHS) {
      const text = descriptionFor(pageMetaFor(path));
      expect(text.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
      expect(text).not.toMatch(/\s{2,}/);
    }
  });
});

describe('isProtectedPath', () => {
  it('covers the login page and every partner surface', () => {
    expect(isProtectedPath('/masuk')).toBe(true);
    expect(isProtectedPath('/partner')).toBe(true);
    expect(isProtectedPath('/partner/laporan/ABC123')).toBe(true);
  });

  it('leaves public pages alone', () => {
    expect(isProtectedPath('/')).toBe(false);
    expect(isProtectedPath('/partneran')).toBe(false);
    expect(isProtectedPath('/laporan/ABC123')).toBe(false);
  });
});
