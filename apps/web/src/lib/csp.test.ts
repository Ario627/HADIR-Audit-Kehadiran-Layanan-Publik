import { describe, expect, it } from 'vitest';

const components = import.meta.glob('../**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const configFiles = import.meta.glob(['../../vite.config.ts', '../../public/sw.js'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function readConfig(fragment: string): string {
  for (const [path, content] of Object.entries(configFiles)) {
    if (path.includes(fragment)) {
      return content;
    }
  }
  return '';
}

const config = readConfig('vite.config.ts');
const serviceWorker = readConfig('sw.js');

describe('inline style ban', () => {
  it('finds the component sources', () => {
    expect(Object.keys(components).length).toBeGreaterThan(20);
  });

  it('never sets a style attribute, because the build CSP forbids it', () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(components)) {
      if (content.includes('style={{')) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never injects raw html', () => {
    const offenders: string[] = [];
    for (const [path, content] of Object.entries(components)) {
      if (content.includes('dangerouslySetInnerHTML')) {
        offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('content security policy', () => {
  it('is defined in the build config', () => {
    expect(config.length).toBeGreaterThan(100);
    expect(config).toContain('Content-Security-Policy');
  });

  it('forbids inline and eval script or style', () => {
    expect(config).not.toContain("'unsafe-inline'");
    expect(config).not.toContain("'unsafe-eval'");
    expect(config).not.toContain('wasm-unsafe-eval');
  });

  it('locks the baseline directives', () => {
    expect(config).toContain("default-src 'self'");
    expect(config).toContain("base-uri 'none'");
    expect(config).toContain("object-src 'none'");
    expect(config).toContain("form-action 'self'");
    expect(config).toContain("script-src 'self'");
    expect(config).toContain("style-src 'self'");
    expect(config).toContain("img-src 'self' data: blob:");
  });

  it('upgrades insecure requests', () => {
    expect(config).toContain('upgrade-insecure-requests');
  });
});

describe('service worker privacy', () => {
  it('is available as source', () => {
    expect(serviceWorker.length).toBeGreaterThan(500);
  });

  it('refuses to cache personal endpoints', () => {
    expect(serviceWorker).toContain('/v1/reports/mine');
    expect(serviceWorker).toContain('/v1/episodes');
    expect(serviceWorker).toContain('/v1/admin');
    expect(serviceWorker).toContain('/v1/internal');
    expect(serviceWorker).toContain('isPrivate');
  });

  it('skips non-GET requests', () => {
    expect(serviceWorker).toContain("request.method !== 'GET'");
  });

  it('skips cross-origin requests', () => {
    expect(serviceWorker).toContain('url.origin !== self.location.origin');
  });

  it('honours no-store and private cache headers', () => {
    expect(serviceWorker).toContain('no-store|private');
  });
});
