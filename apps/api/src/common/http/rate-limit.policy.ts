import { SetMetadata } from '@nestjs/common';

export type RateLimitScope = 'ip' | 'device' | 'device+ip' | 'user';

export interface RateLimitPolicy {
  name: string;
  limit: number;
  windowMs: number;
  scope: RateLimitScope;
}

export const RATE_LIMIT_KEY = 'hadir:rate-limit';
export const SKIP_RATE_LIMIT_KEY = 'hadir:rate-limit:skip';

export const RateLimit = (...policies: RateLimitPolicy[]) =>
  SetMetadata(RATE_LIMIT_KEY, policies);

export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

export const DEFAULT_MUTATION_POLICY: RateLimitPolicy = {
  name: 'mutation-default',
  limit: 60,
  windowMs: 60_000,
  scope: 'device+ip',
};

export const RATE_LIMIT_POLICIES = {
  deviceBootstrap: {
    name: 'device-bootstrap',
    limit: 10,
    windowMs: 3_600_000,
    scope: 'ip',
  },
  partnerLogin: {
    name: 'partner-login',
    limit: 10,
    windowMs: 600_000,
    scope: 'ip',
  },
  partnerAction: {
    name: 'partner-action',
    limit: 120,
    windowMs: 3_600_000,
    scope: 'user',
  },
  partnerOtp: {
    name: 'partner-otp',
    limit: 5,
    windowMs: 900_000,
    scope: 'ip',
  },
  qrLanding: {
    name: 'qr-landing',
    limit: 60,
    windowMs: 60_000,
    scope: 'ip',
  },
  stopsRead: {
    name: 'stops-read',
    limit: 120,
    windowMs: 60_000,
    scope: 'ip',
  },
  coverageRead: {
    name: 'coverage-read',
    limit: 30,
    windowMs: 60_000,
    scope: 'ip',
  },
  episodeStartHourly: {
    name: 'episode-start-hourly',
    limit: 6,
    windowMs: 3_600_000,
    scope: 'device',
  },
  episodeStartDaily: {
    name: 'episode-start-daily',
    limit: 30,
    windowMs: 86_400_000,
    scope: 'device',
  },
  episodeUpdateHourly: {
    name: 'episode-update-hourly',
    limit: 20,
    windowMs: 3_600_000,
    scope: 'device',
  },
  episodeHeartbeat: {
    name: 'episode-heartbeat',
    limit: 2,
    windowMs: 60_000,
    scope: 'device',
  },
  episodeRead: {
    name: 'episode-read',
    limit: 120,
    windowMs: 60_000,
    scope: 'device+ip',
  },
  triage: {
    name: 'triage',
    limit: 30,
    windowMs: 3_600_000,
    scope: 'device',
  },
  triageRead: {
    name: 'triage-read',
    limit: 120,
    windowMs: 60_000,
    scope: 'device+ip',
  },
  reportHourly: {
    name: 'report-hourly',
    limit: 5,
    windowMs: 3_600_000,
    scope: 'device',
  },
  reportDaily: {
    name: 'report-daily',
    limit: 20,
    windowMs: 86_400_000,
    scope: 'device',
  },
  reportCreateIp: {
    name: 'report-create-ip',
    limit: 60,
    windowMs: 3_600_000,
    scope: 'ip',
  },
  reportAction: {
    name: 'report-action',
    limit: 30,
    windowMs: 3_600_000,
    scope: 'device',
  },
  reportsRead: {
    name: 'reports-read',
    limit: 120,
    windowMs: 60_000,
    scope: 'ip',
  },
  deviceRead: {
    name: 'device-read',
    limit: 120,
    windowMs: 60_000,
    scope: 'device+ip',
  },
  upload: {
    name: 'upload',
    limit: 20,
    windowMs: 3_600_000,
    scope: 'device',
  },
  partnerRead: {
    name: 'partner-read',
    limit: 300,
    windowMs: 60_000,
    scope: 'user',
  },
  partnerExport: {
    name: 'partner-export',
    limit: 5,
    windowMs: 3_600_000,
    scope: 'user',
  },
  authOtp: {
    name: 'auth-otp',
    limit: 5,
    windowMs: 900_000,
    scope: 'ip',
  },
} as const satisfies Record<string, RateLimitPolicy>;