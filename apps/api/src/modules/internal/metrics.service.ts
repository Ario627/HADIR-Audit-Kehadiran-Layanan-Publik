import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { poolStats } from '../../db/client';
import type { Database } from '../../db/client';
import { DATABASE } from '../../db/db.module';
import { OutboxRepository } from '../../db/repositories/outbox.repository';

const CACHE_TTL_MS = 15_000;
const MEMORY_KINDS = ['rss', 'heapTotal', 'heapUsed', 'external'] as const;

interface CachedSnapshot {
  at: number;
  body: string;
}

function metric(name: string, help: string, type: string, lines: string[]): string {
  return [`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines].join('\n');
}

function label(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"').replace(/\n/gu, '\\n');
}

@Injectable()
export class MetricsService {
  private cached: CachedSnapshot | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly outbox: OutboxRepository,
  ) {}

  async render(): Promise<string> {
    const now = Date.now();
    if (this.cached !== null && now - this.cached.at < CACHE_TTL_MS) {
      return this.cached.body;
    }
    const body = await this.build();
    this.cached = { at: now, body };
    return body;
  }

  private async build(): Promise<string> {
    const memory = process.memoryUsage();
    const pool = poolStats();
    const outboxStats = await this.outbox.stats(5);
    const reports = await this.reportCounts();

    const blocks: string[] = [];

    blocks.push(
      metric(
        'hadir_process_uptime_seconds',
        'Waktu proses berjalan dalam detik.',
        'counter',
        [`hadir_process_uptime_seconds ${process.uptime().toFixed(3)}`],
      ),
    );

    blocks.push(
      metric(
        'hadir_process_memory_bytes',
        'Penggunaan memori proses per jenis.',
        'gauge',
        MEMORY_KINDS.map(
          (kind) => `hadir_process_memory_bytes{kind="${label(kind)}"} ${memory[kind]}`,
        ),
      ),
    );

    blocks.push(
      metric(
        'hadir_db_pool_connections',
        'Jumlah koneksi pool PostgreSQL per status.',
        'gauge',
        [
          `hadir_db_pool_connections{state="total"} ${pool.total}`,
          `hadir_db_pool_connections{state="idle"} ${pool.idle}`,
          `hadir_db_pool_connections{state="waiting"} ${pool.waiting}`,
        ],
      ),
    );

    blocks.push(
      metric(
        'hadir_outbox_jobs',
        'Jumlah job outbox per kondisi.',
        'gauge',
        [
          `hadir_outbox_jobs{state="pending"} ${outboxStats.pending}`,
          `hadir_outbox_jobs{state="exhausted"} ${outboxStats.exhausted}`,
        ],
      ),
    );

    blocks.push(
      metric(
        'hadir_outbox_oldest_pending_seconds',
        'Usia job outbox tertua yang masih pending.',
        'gauge',
        [
          `hadir_outbox_oldest_pending_seconds ${outboxStats.oldestPendingSeconds ?? 0}`,
        ],
      ),
    );

    blocks.push(
      metric(
        'hadir_reports_total',
        'Jumlah laporan per status moderasi.',
        'gauge',
        reports.map(
          (row) =>
            `hadir_reports_total{moderation="${label(row.moderation)}"} ${row.count}`,
        ),
      ),
    );

    return `${blocks.join('\n\n')}\n`;
  }

  private async reportCounts(): Promise<{ moderation: string; count: number }[]> {
    const result = await this.db.execute(sql`
      SELECT moderation::text AS moderation, count(*)::int AS total
      FROM reports
      GROUP BY moderation
      ORDER BY moderation
    `);
    return result.rows.map((row) => {
      const record = row as Record<string, unknown>;
      return {
        moderation: typeof record.moderation === 'string' ? record.moderation : 'unknown',
        count: Number(record.total ?? 0),
      };
    });
  }
}
