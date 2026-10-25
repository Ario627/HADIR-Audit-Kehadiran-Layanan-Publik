# HADIR API

NestJS 12 service for HADIR. This is the walking skeleton: health, stops, wait episodes,
descriptive estimates and a triage stub. Persistence is in-memory until the PostgreSQL/Drizzle
milestone lands.

## Run

```bash
cp .env.example .env
pnpm --filter @hadir/api start:dev
```

- API: http://localhost:3000
- Health: http://localhost:3000/healthz
- Stops: http://localhost:3000/v1/stops

## Endpoints (v1)

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz`, `/readyz` | No version prefix |
| GET | `/v1/stops?q=&limit=` | Demo fixtures, `isDemo: true` |
| GET | `/v1/stops/:code` | Details; `null` when unknown |
| GET | `/v1/stops/:code/estimate?window=7d\|30d` | Descriptive stats, no CI yet |
| POST | `/v1/episodes` | Body matches `StartEpisodeInput` in `@hadir/contracts` |
| PATCH | `/v1/episodes/:id` | `boarded`, `abandoned`, `passed_full`, `cancelled` |
| GET | `/v1/episodes/:id` | Device-scoped |
| POST | `/v1/triage` | Stub: duplicates/RUP/authority are `not_configured` |
| POST | `/v1/dev/simulate` | Dev only; every row flagged `simulated` |

Device identity is a signed HttpOnly cookie. The server derives a daily-rotating pseudonym and
never accepts coordinates — only distance/accuracy buckets.

## Tests

```bash
pnpm --filter @hadir/api test
pnpm --filter @hadir/api test:e2e
```

## Not implemented yet

- PostgreSQL/PostGIS + Drizzle migrations
- Kaplan–Meier estimator and confidence intervals
- Report lifecycle, partner inbox, hash chain, radar
- Rate limiting, idempotency table, uploads

See `docs/06-BACKEND.md` and `docs/19-ADR.md` for the target design.
