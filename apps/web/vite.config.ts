import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';

function originOf(value: string | undefined): string {
  if (value === undefined || value.trim().length === 0) {
    return '';
  }
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

function contentSecurityPolicy(apiOrigin: string): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self'",
    "script-src 'self'",
    apiOrigin.length === 0 ? "connect-src 'self'" : `connect-src 'self' ${apiOrigin}`,
    "manifest-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function cspMeta(apiOrigin: string): Plugin {
  const content = contentSecurityPolicy(apiOrigin);
  return {
    name: 'hadir-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content },
            injectTo: 'head-prepend',
          },
        ],
      };
    },
  };
}

export default defineConfig(({ mode }) => {
  const apiOrigin = originOf(loadEnv(mode, '.', 'VITE_').VITE_API_URL);
  const apiPort = Number.parseInt(process.env['HADIR_API_PORT'] ?? '3000', 10) || 3000;
  const webPort = Number.parseInt(process.env['HADIR_WEB_PORT'] ?? '5173', 10) || 5173;
  const proxyTarget = `http://localhost:${String(apiPort)}`;
  return {
    plugins: [
      cspMeta(apiOrigin),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: './src/routes',
        generatedRouteTree: './src/routeTree.gen.ts',
      }),
      react(),
      tailwindcss(),
    ],
    server: {
      port: webPort,
      strictPort: true,
      proxy: {
        '/v1': { target: proxyTarget, changeOrigin: true },
        '/healthz': { target: proxyTarget, changeOrigin: true },
        '/readyz': { target: proxyTarget, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
    build: {
      target: 'baseline-widely-available',
      sourcemap: true,
    },
  };
});
