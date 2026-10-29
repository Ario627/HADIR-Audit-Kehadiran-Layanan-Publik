# HADIR API

NestJS 12 service for HADIR. Current scope: health, stops, QR landing, device identity, wait
episodes, and descriptive estimates. Persistence uses PostgreSQL/PostGIS through Drizzle.

## Run

```bash
cp .env.example .env
pnpm --filter @hadir/api db:migrate
pnpm --filter @hadir/api db:seed
pnpm --filter @hadir/api start:dev
```

- API: http://localhost:3000
- Health: http://localhost:3000/healthz
- Readiness: http://localhost:3000/readyz
- Stops: http://localhost:3000/v1/stops

## Endpoints (v1)

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz`, `/readyz` | No version prefix |
| GET | `/v1/stops?q=&city=&bbox=&limit=&cursor=` | Reads PostgreSQL |
| GET | `/v1/stops/:id` | Stop detail |
| GET | `/v1/s/:stopCode?e=&k=&s=` | QR landing with HMAC proof |
| GET | `/v1/stops/:id/estimate?window=7d\|30d&routeId=` | Descriptive stats, no CI yet |
| POST | `/v1/devices` | Issues device + CSRF cookies |
| POST | `/v1/episodes` | Requires `Idempotency-Key`; device cookie + CSRF |
| PATCH | `/v1/episodes/:id` | Device-scoped; requires idempotency + CSRF |
| GET | `/v1/episodes/active` | Device-scoped active episode |
| GET | `/v1/episodes/:id` | Device-scoped episode |

Triage, reports, partner inbox, estimator, runway, and uploads are not implemented yet.

Device identity is a signed HttpOnly cookie. The server derives a rotating pseudonym and never
accepts coordinates — only distance/accuracy buckets. Mutations with a cookie require a trusted
`Origin` and `X-CSRF-Token`; see `src/common/security/csrf.ts`.

## Seed

```bash
pnpm --filter @hadir/api db:seed
```

The seed is idempotent for demo rows and refuses to run in production. It creates 1 city,
2 corridors, 12 stops, 3 devices, and 200 episodes flagged `simulated`. Re-running the seed
replaces only simulated episodes for the seed devices.

## Tests

```bash
pnpm --filter @hadir/api test
pnpm --filter @hadir/api test:e2e
```

`test:e2e` runs migrations and seed first against `DATABASE_URL`. Jest runs in ESM mode because
NestJS 12 packages are ESM-only.

## Not implemented yet

- Kaplan–Meier estimator and confidence intervals
- Triage rules, report lifecycle, partner inbox, hash chain, radar
- Uploads, anchor, OpenAPI, OTel

See `docs/06-BACKEND.md` and `docs/19-ADR.md` for the target design.
