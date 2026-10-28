import { Inject, Injectable } from '@nestjs/common';
import type { RunwayEventKind, RunwayStatus } from '@hadir/contracts';
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';
import { routes, runwayEvents, serviceRunway } from '../schema';

export interface RunwayRow {
  runwayId: string;
  routeId: string;
  routeCode: string;
  routeName: string;
  declared: RunwayStatus;
  fundedUntil: string | null;
  sourceUrl: string | null;
  decisionDoc: string | null;
  decisionDate: string | null;
  note: string | null;
}

export interface RunwayEventRow {
  seq: number;
  kind: RunwayEventKind;
  note: string;
  sourceUrl: string;
  occurredAt: Date;
}

export interface RunwayFilter {
  status: RunwayStatus | null;
  limit: number;
}

const runwaySelection = {
  runwayId: serviceRunway.id,
  routeId: serviceRunway.routeId,
  routeCode: routes.code,
  routeName: routes.name,
  declared: serviceRunway.status,
  fundedUntil: serviceRunway.fundedUntil,
  sourceUrl: serviceRunway.sourceUrl,
  decisionDoc: serviceRunway.decisionDoc,
  decisionDate: serviceRunway.decisionDate,
  note: serviceRunway.note,
};

function eventSelection() {
  return {
    seq: runwayEvents.seq,
    kind: runwayEvents.kind,
    note: runwayEvents.note,
    sourceUrl: runwayEvents.sourceUrl,
    occurredAt: runwayEvents.occurredAt,
  };
}

@Injectable()
export class RunwayRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByRouteId(routeId: string): Promise<RunwayRow | null> {
    const rows = await this.db
      .select(runwaySelection)
      .from(serviceRunway)
      .innerJoin(routes, eq(routes.id, serviceRunway.routeId))
      .where(eq(serviceRunway.routeId, routeId))
      .limit(1);
    return rows[0] ?? null;
  }

  async list(filter: RunwayFilter): Promise<RunwayRow[]> {
    const conditions: SQL[] = [];
    if (filter.status !== null) {
      conditions.push(eq(serviceRunway.status, filter.status));
    }
    const where =
      conditions.length === 0
        ? undefined
        : conditions.reduce((current, item) => sql`${current} AND ${item}`, sql`true`);
    return this.db
      .select(runwaySelection)
      .from(serviceRunway)
      .innerJoin(routes, eq(routes.id, serviceRunway.routeId))
      .where(where)
      .orderBy(asc(serviceRunway.fundedUntil), asc(routes.code))
      .limit(Math.min(filter.limit, 100));
  }

  async listEvents(runwayId: string): Promise<RunwayEventRow[]> {
    return this.db
      .select(eventSelection())
      .from(runwayEvents)
      .where(eq(runwayEvents.runwayId, runwayId))
      .orderBy(asc(runwayEvents.seq))
      .limit(200);
  }

  async listEventsForRunways(
    runwayIds: readonly string[],
  ): Promise<Map<string, RunwayEventRow[]>> {
    const grouped = new Map<string, RunwayEventRow[]>();
    if (runwayIds.length === 0) {
      return grouped;
    }
    const rows = await this.db
      .select({
        runwayId: runwayEvents.runwayId,
        seq: runwayEvents.seq,
        kind: runwayEvents.kind,
        note: runwayEvents.note,
        sourceUrl: runwayEvents.sourceUrl,
        occurredAt: runwayEvents.occurredAt,
      })
      .from(runwayEvents)
      .where(inArray(runwayEvents.runwayId, [...runwayIds]))
      .orderBy(asc(runwayEvents.runwayId), asc(runwayEvents.seq));
    for (const row of rows) {
      const bucket = grouped.get(row.runwayId);
      const event: RunwayEventRow = {
        seq: row.seq,
        kind: row.kind,
        note: row.note,
        sourceUrl: row.sourceUrl,
        occurredAt: row.occurredAt,
      };
      if (bucket === undefined) {
        grouped.set(row.runwayId, [event]);
      } else if (bucket.length < 200) {
        bucket.push(event);
      }
    }
    return grouped;
  }
}