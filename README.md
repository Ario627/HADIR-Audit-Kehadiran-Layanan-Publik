# HADIR

Instrumen audit warga untuk layanan bus bersubsidi. Warga mencatat lama tunggu lewat QR di
halte; sistem mengubahnya menjadi bukti yang bisa dibandingkan dengan janji layanan — tanpa
menuduh sebelum bukti cukup.

Dokumentasi lengkap ada di [`../docs/00-INDEX.md`](../docs/00-INDEX.md).

## Status

| Bagian | Status |
|---|---|
| Dokumentasi | ✅ 25 file, `draft` |
| `apps/api` | 🟡 Walking skeleton: health, stops, episodes, descriptive estimate, triage stub |
| `apps/web` | 🟡 Landing, QR stop page, wait ticket, methodology |
| `packages/contracts` | ✅ Zod schemas, CJS build |
| `packages/domain` | ✅ Evidence levels, presence trust, wait stats, formatting |
| PostgreSQL/PostGIS | ⚪ Compose siap; skema & migrasi belum |
| Estimator (FastAPI) | ⚪ Spesifikasi siap; implementasi belum |
| Data lapangan | ⚪ Belum ada. Semua halte di API adalah contoh (`isDemo: true`) |

## Quickstart

Prasyarat: Node 24+ (repo diuji di 26.12.1), pnpm 12, Docker (opsional untuk PostGIS/Redis).

```bash
pnpm install
cp apps/api/.env.example apps/api/.env

# terminal 1
pnpm dev:api        # http://localhost:3000

# terminal 2
pnpm dev:web        # http://localhost:5173
```

Vite mem-proxy `/v1` ke `http://localhost:3000`, jadi tidak perlu CORS di dev.

### Seed angka demo (opsional)

```bash
curl -X POST http://localhost:3000/v1/dev/simulate \
  -H 'content-type: application/json' \
  -d '{"stopCode":"BMS-A12","n":34}'
```

Semua baris diberi `qualityFlags: ["simulated"]`; UI menampilkan label **SIMULASI** dan tidak
memakainya untuk menyimpulkan.

### Infrastruktur lokal

```bash
pnpm db:up     # PostGIS 18-3.6, Redis 8.10, MinIO
pnpm db:down
```

## Struktur

```text
apps/
  api/                NestJS 12 — HTTP, device cookie, stops, episodes, triage stub
  web/                Vite 8 + React 19.3 + TanStack Router/Query, Tailwind 4
packages/
  contracts/          Zod schemas + DTO types (CJS)
  domain/             Pure logic: evidence, presence, stats (CJS)
  config/             Shared tsconfig/oxlint presets
infra/compose/        Local PostGIS, Redis, MinIO
docs/                 Product, architecture, security, design, roadmap
```

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm dev` | API + web bersamaan (Turbo) |
| `pnpm build` | Build semua paket/app |
| `pnpm typecheck` | TypeScript tanpa emit |
| `pnpm test` | Unit test (Vitest + Jest) |
| `pnpm lint` | Oxlint |
| `pnpm check` | lint + typecheck + test |
| `pnpm format` | Prettier |

## Keputusan yang perlu diketahui

- **TypeScript 6.0.2, bukan 7.0.2.** NestJS membutuhkan `emitDecoratorMetadata`; port native
  TS 7 belum divalidasi untuk decorator legacy. Spike ada di `docs/19-ADR.md` (ADR-026).
- **SPA, bukan SSR.** TanStack Start belum dipakai; lihat ADR-006.
- **In-memory API.** Semua state hilang saat restart. Milestone berikutnya: PostGIS + Drizzle.
- **Estimasi masih deskriptif.** `methodVersion: simple-stats-v0`; tidak ada CI, tidak ada
  Kaplan–Meier, dan `direction` selalu `inconclusive` sampai estimator aktif.
- **Data contoh.** Jangan mengutip angka build ini sebagai temuan lapangan.

## Keamanan singkat

- Cookie perangkat `HttpOnly`, `SameSite=Lax`, `Secure` di produksi; pseudonim berputar harian.
- `helmet`, CORS allowlist, body limit 256 KB, error `application/problem+json` tanpa stack.
- `/v1/dev/*` mati di produksi.
- Jangan commit `.env`. Rotasi kunci `OBSERVE_*` lama: sudah tidak dipakai dan sebaiknya
  dicabut di dashboard penyedia.

## Lisensi

Apache-2.0 (kode). Dokumentasi CC BY 4.0. Data contoh bukan data layanan nyata.
