import type { RunwayEventRow, RunwayRow } from '../../db/repositories/runway.repository';
import { RunwayRepository } from '../../db/repositories/runway.repository';
import { RunwayService } from './runway.service';

interface QueryLog {
  listCalls: number;
  batchCalls: number;
  perRunwayCalls: number;
  batches: string[][];
  lastSingle: string | null;
}

function row(index: number): RunwayRow {
  return {
    runwayId: `0192f0c4-0000-7000-8000-0000000000${String(index).padStart(2, '0')}`,
    routeId: `0192f0c4-0000-7000-8000-0000000001${String(index).padStart(2, '0')}`,
    routeCode: `K3${index}`,
    routeName: `Koridor ${index}`,
    declared: 'funded',
    fundedUntil: '2027-12-31',
    sourceUrl: null,
    decisionDoc: null,
    decisionDate: null,
    note: null,
  };
}

function event(runwayId: string, seq: number): RunwayEventRow {
  return {
    seq,
    kind: 'announced',
    note: `Catatan ${seq}`,
    sourceUrl: 'https://example.test/doc',
    occurredAt: new Date('2026-10-01T00:00:00.000Z'),
  };
}

function repositoryDouble(rows: RunwayRow[], log: QueryLog): RunwayRepository {
  return {
    list: async () => {
      log.listCalls += 1;
      return rows;
    },
    findByRouteId: async (routeId: string) => rows.find((item) => item.routeId === routeId) ?? null,
    listEventsForRunways: async (ids: readonly string[]) => {
      log.batchCalls += 1;
      log.batches.push([...ids]);
      const grouped = new Map<string, RunwayEventRow[]>();
      for (const id of ids) {
        grouped.set(id, [event(id, 1), event(id, 2)]);
      }
      return grouped;
    },
    listEvents: async (runwayId: string) => {
      log.perRunwayCalls += 1;
      log.lastSingle = runwayId;
      return [event(runwayId, 1), event(runwayId, 2)];
    },
  } as unknown as RunwayRepository;
}

function newLog(): QueryLog {
  return { listCalls: 0, batchCalls: 0, perRunwayCalls: 0, batches: [], lastSingle: null };
}

describe('RunwayService.list', () => {
  it('fetches events for every runway in a single query', async () => {
    const rows = [row(1), row(2), row(3), row(4), row(5)];
    const log = newLog();
    const service = new RunwayService(repositoryDouble(rows, log));

    const result = await service.list({ limit: 10 });

    expect(log.listCalls).toBe(1);
    expect(log.batchCalls).toBe(1);
    expect(log.perRunwayCalls).toBe(0);
    expect(result).toHaveLength(5);
    expect(result[0]?.events).toHaveLength(2);
  });

  it('asks for exactly the runway ids it has', async () => {
    const rows = [row(1), row(2)];
    const log = newLog();
    const service = new RunwayService(repositoryDouble(rows, log));

    await service.list({ limit: 10 });

    expect(log.batches[0]).toEqual(rows.map((item) => item.runwayId));
  });

  it('keeps the declared event order', async () => {
    const log = newLog();
    const service = new RunwayService(repositoryDouble([row(1)], log));

    const result = await service.list({ limit: 10 });

    expect(result[0]?.events.map((item) => item.seq)).toEqual([1, 2]);
  });

  it('still returns a runway when no events exist', async () => {
    const rows = [row(1)];
    const repository = {
      list: async () => rows,
      findByRouteId: async () => null,
      listEventsForRunways: async () => new Map(),
    } as unknown as RunwayRepository;
    const service = new RunwayService(repository);

    const result = await service.list({ limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]?.events).toEqual([]);
  });

  it('applies the status filter before the limit', async () => {
    const rows = [row(1), row(2)];
    const log = newLog();
    const service = new RunwayService(repositoryDouble(rows, log));

    const result = await service.list({ limit: 10, status: 'stopped' });

    expect(result).toEqual([]);
  });

  it('does not re-query on an identical follow-up call', async () => {
    const rows = [row(1)];
    const log = newLog();
    const service = new RunwayService(repositoryDouble(rows, log));

    await service.list({ limit: 10 });
    await service.list({ limit: 10 });

    expect(log.listCalls).toBe(1);
    expect(log.batchCalls).toBe(1);
  });
});

describe('RunwayService.byRoute', () => {
  it('reads events using the runway id already carried by the row', async () => {
    const log = newLog();
    const target = row(7);
    const service = new RunwayService(repositoryDouble([target], log));

    const runway = await service.byRoute(target.routeId);

    expect(runway.routeId).toBe(target.routeId);
    expect(runway.events).toHaveLength(2);
    expect(log.perRunwayCalls).toBe(1);
    expect(log.lastSingle).toBe(target.runwayId);
  });

  it('throws NOT_FOUND when the corridor has no runway record', async () => {
    const log = newLog();
    const service = new RunwayService(repositoryDouble([], log));

    await expect(service.byRoute('0192f0c4-0000-7000-8000-0000000000ff')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
