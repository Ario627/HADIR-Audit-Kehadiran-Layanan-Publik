import { Injectable } from '@nestjs/common';
import type { Runway, RunwayListQuery, RunwayStatus } from '@hadir/contracts';
import { MemoCache } from '../../common/cache/memo-cache';
import { env } from '../../common/config/env';
import { AppError } from '../../common/errors/app-error';
import {
  RunwayRepository,
  type RunwayEventRow,
  type RunwayRow,
} from '../../db/repositories/runway.repository';
import {
  daysRemaining,
  deriveStatus,
  disclaimerFor,
  jakartaToday,
  sanctionsFor,
  urgencyBand,
} from './runway.timing';

const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 512;

export function mapEvent(row: RunwayEventRow): Runway['events'][number] {
  return {
    seq: row.seq,
    kind: row.kind,
    note: row.note,
    sourceUrl: row.sourceUrl,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export function toRunway(
  row: RunwayRow,
  events: readonly RunwayEventRow[],
  today: string,
  simulated: boolean,
): Runway {
  const clock = { today };
  const status = deriveStatus({
    declared: row.declared,
    fundedUntil: row.fundedUntil,
    clock,
  });
  const remaining = daysRemaining(row.fundedUntil, clock);
  return {
    routeId: row.routeId,
    routeCode: row.routeCode,
    routeName: row.routeName,
    status,
    urgency: urgencyBand(remaining),
    fundedUntil: row.fundedUntil,
    daysRemaining: remaining,
    sourceUrl: row.sourceUrl,
    decisionDoc: row.decisionDoc,
    decisionDate: row.decisionDate,
    note: row.note,
    sanctions: sanctionsFor(row.note),
    events: events.map(mapEvent),
    disclaimer: disclaimerFor(),
    simulated,
    computedAt: new Date().toISOString(),
  };
}

function withinFilter(runway: Runway, query: RunwayListQuery): boolean {
  if (query.status !== undefined && runway.status !== query.status) {
    return false;
  }
  if (query.urgency !== undefined && runway.urgency !== query.urgency) {
    return false;
  }
  return true;
}

@Injectable()
export class RunwayService {
  private readonly cache = new MemoCache<Runway | null>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
  });
  private readonly listCache = new MemoCache<Runway[]>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: 128,
  });

  constructor(private readonly repository: RunwayRepository) {}

  private async compute(routeId: string, today: string, simulated: boolean): Promise<Runway | null> {
    const row = await this.repository.findByRouteId(routeId);
    if (row === null) {
      return null;
    }
    const events = await this.repository.listEvents(row.runwayId);
    return toRunway(row, events, today, simulated);
  }

  async byRoute(routeId: string): Promise<Runway> {
    const today = jakartaToday(new Date());
    const simulated = env.devTools;
    const key = `${routeId}|${today}|${simulated ? 'demo' : 'live'}`;
    const runway = await this.cache.getOrLoad(key, () =>
      this.compute(routeId, today, simulated),
    );
    if (runway === null) {
      throw new AppError('NOT_FOUND', {
        detail: 'Belum ada informasi pendanaan untuk koridor ini.',
      });
    }
    return runway;
  }

  async events(routeId: string): Promise<Runway['events']> {
    const runway = await this.byRoute(routeId);
    return runway.events;
  }

  async list(query: RunwayListQuery): Promise<Runway[]> {
    const today = jakartaToday(new Date());
    const simulated = env.devTools;
    const key = `${query.status ?? '-'}|${today}|${simulated ? 'demo' : 'live'}`;
    const items = await this.listCache.getOrLoad(key, async () => {
      const rows = await this.repository.list({
        status: query.status ?? null,
        limit: 100,
      });
      const grouped = await this.repository.listEventsForRunways(
        rows.map((row) => row.runwayId),
      );
      return rows.map((row) =>
        toRunway(row, grouped.get(row.runwayId) ?? [], today, simulated),
      );
    });
    return items.filter((item) => withinFilter(item, query)).slice(0, query.limit);
  }

  async statusFor(routeId: string): Promise<RunwayStatus | null> {
    const row = await this.repository.findByRouteId(routeId);
    if (row === null) {
      return null;
    }
    return deriveStatus({
      declared: row.declared,
      fundedUntil: row.fundedUntil,
      clock: { today: jakartaToday(new Date()) },
    });
  }
}