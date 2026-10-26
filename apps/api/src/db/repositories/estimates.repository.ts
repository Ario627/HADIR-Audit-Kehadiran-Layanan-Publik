import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../client';
import { DATABASE } from '../db.module';
import { waitEpisodes } from '../schema';

export interface EstimateEpisodeRow {
  durationS: number | null;
  outcome: string | null;
  deviceHash: string;
  day: string;
  hour: number;
}

const MAX_ROWS = 5_000;

@Injectable()
export class EstimatesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async loadEpisodes(
    stopId: string,
    routeId: string | null,
    start: Date,
    end: Date,
  ): Promise<EstimateEpisodeRow[]> {
    const day = sql<string>`to_char(${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD')`;
    const hour = sql<number>`EXTRACT(HOUR FROM (${waitEpisodes.startedAt} AT TIME ZONE 'Asia/Jakarta'))::int`;
    const conditions: SQL[] = [
      eq(waitEpisodes.stopId, stopId),
      gte(waitEpisodes.startedAt, start),
      lt(waitEpisodes.startedAt, end),
      sql`NOT ('simulated' = ANY(${waitEpisodes.qualityFlags}))`,
    ];
    if (routeId !== null) {
      conditions.push(eq(waitEpisodes.routeId, routeId));
    }
    const rows = await this.db
      .select({
        durationS: waitEpisodes.durationS,
        outcome: waitEpisodes.outcome,
        deviceHash: waitEpisodes.deviceHash,
        day,
        hour,
      })
      .from(waitEpisodes)
      .where(and(...conditions))
      .orderBy(desc(waitEpisodes.startedAt))
      .limit(MAX_ROWS + 1);
    return rows;
  }
}