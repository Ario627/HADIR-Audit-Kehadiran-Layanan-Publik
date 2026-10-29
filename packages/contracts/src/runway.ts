import { z } from 'zod';
import { IsoDateTime, Uuid } from './common';

export const RunwayStatus = z.enum(['funded', 'pending', 'stopped', 'unknown']);

export const RunwayEventKind = z.enum([
  'announced',
  'budget_decided',
  'funded',
  'suspended',
  'resumed',
  'stopped',
  'corrected',
]);

export const UrgencyBand = z.enum(['expired', 'critical', 'warning', 'watch', 'none']);

export const RunwayEvent = z.object({
  seq: z.number().int().positive(),
  kind: RunwayEventKind,
  note: z.string().min(1).max(500),
  sourceUrl: z.url(),
  occurredAt: IsoDateTime,
});

export const Runway = z.object({
  routeId: Uuid,
  routeCode: z.string().min(1).max(12),
  routeName: z.string().min(1).max(120),
  status: RunwayStatus,
  urgency: UrgencyBand,
  fundedUntil: z.string().max(10).nullable(),
  daysRemaining: z.number().int().nullable(),
  sourceUrl: z.url().nullable(),
  decisionDoc: z.string().max(500).nullable(),
  decisionDate: z.string().max(10).nullable(),
  note: z.string().max(500).nullable(),
  sanctions: z.array(z.string().min(1).max(200)).max(5),
  events: z.array(RunwayEvent).max(200),
  disclaimer: z.string().min(1).max(300),
  simulated: z.boolean(),
  computedAt: IsoDateTime,
});

export const RunwayListQuery = z
  .object({
    status: RunwayStatus.optional(),
    urgency: UrgencyBand.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type RunwayStatus = z.infer<typeof RunwayStatus>;
export type RunwayEventKind = z.infer<typeof RunwayEventKind>;
export type UrgencyBand = z.infer<typeof UrgencyBand>;
export type RunwayEvent = z.infer<typeof RunwayEvent>;
export type Runway = z.infer<typeof Runway>;
export type RunwayListQuery = z.infer<typeof RunwayListQuery>;