import type {
  CoveragePeriod,
  CoverageSummaryItem,
  EvidenceLevel,
  StopSummary,
} from '@hadir/contracts';
import { safeExternalUrl } from './safe-url';

export interface BoardFilter {
  q: string;
  sort: BoardSort;
  level: BoardLevelFilter;
}

export interface BoardQuery extends BoardFilter {
  period: CoveragePeriod;
}

export interface BoardRow {
  stopId: string;
  code: string;
  name: string;
  status: StopSummary['status'];
  isDemo: boolean;
  corridors: readonly string[];
  promiseMinutes: number | null;
  promiseSource: string | null;
  episodes: number;
  devices: number;
  days: number;
  level: EvidenceLevel;
}

export interface BoardTotals {
  listed: number;
  measured: number;
  withIndication: number;
  episodes: number;
}

export type BoardLevelFilter = EvidenceLevel | 'all';
export type BoardSearchParams = Partial<BoardQuery>;
export type BoardSort = 'measured' | 'code' | 'name';

const SORTS: readonly BoardSort[] = ['measured', 'code', 'name'];
const LEVELS: readonly BoardLevelFilter[] = [
  'all',
  'none',
  'indication',
  'strong',
  'field_verified',
];
const QUERY_MIN_LENGTH = 2;
const QUERY_MAX_LENGTH = 100;

export function isBoardSort(value: unknown): value is BoardSort {
  return SORTS.some((sort) => sort === value);
}

export function asBoardSort(value: unknown): BoardSort {
  return isBoardSort(value) ? value : 'measured';
}

export function isBoardLevelFilter(value: unknown): value is BoardLevelFilter {
  return LEVELS.some((level) => level === value);
}

export function asBoardLevelFilter(value: unknown): BoardLevelFilter {
  return isBoardLevelFilter(value) ? value : 'all';
}

export function readQueryParam(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length < QUERY_MIN_LENGTH || trimmed.length > QUERY_MAX_LENGTH) {
    return '';
  }
  return trimmed;
}

export function readPeriod(value: unknown): CoveragePeriod {
  return value === '30d' ? '30d' : '7d';
}

export function readFilter(raw: Record<string, unknown>): BoardQuery {
  return {
    q: readQueryParam(raw.q),
    sort: asBoardSort(raw.sort),
    level: asBoardLevelFilter(raw.level),
    period: readPeriod(raw.period),
  };
}

export function toSearchParams(filter: BoardQuery): BoardSearchParams {
  const output: BoardSearchParams = {};
  if (filter.q.length > 0) {
    output.q = filter.q;
  }
  if (filter.sort !== 'measured') {
    output.sort = filter.sort;
  }
  if (filter.level !== 'all') {
    output.level = filter.level;
  }
  if (filter.period !== '7d') {
    output.period = filter.period;
  }
  return output;
}

function matchesQuery(row: BoardRow, query: string): boolean {
  if (query.length === 0) {
    return true;
  }
  const needle = query.toLowerCase();
  if (row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle)) {
    return true;
  }
  return row.corridors.some((code) => code.toLowerCase().includes(needle));
}

function corridorsOf(stop: StopSummary): readonly string[] {
  return stop.routes.map((route) => route.code);
}

function promiseOf(stop: StopSummary): { minutes: number | null; source: string | null } {
  for (const route of stop.routes) {
    if (route.promisedHeadwayPeakMin === null) {
      continue;
    }
    return {
      minutes: route.promisedHeadwayPeakMin,
      source: safeExternalUrl(route.headwaySourceUrl),
    };
  }
  return { minutes: null, source: null };
}

function toRow(stop: StopSummary, coverage: CoverageSummaryItem | undefined): BoardRow {
  const promise = promiseOf(stop);
  return {
    stopId: stop.id,
    code: stop.code,
    name: stop.name,
    status: stop.status,
    isDemo: stop.isDemo,
    corridors: corridorsOf(stop),
    promiseMinutes: promise.minutes,
    promiseSource: promise.source,
    episodes: coverage?.n ?? 0,
    devices: coverage?.devices ?? 0,
    days: coverage?.days ?? 0,
    level: coverage?.level ?? 'none',
  };
}

function compareBy(sort: BoardSort): (left: BoardRow, right: BoardRow) => number {
  if (sort === 'code') {
    return (left, right) => left.code.localeCompare(right.code, 'id');
  }
  if (sort === 'name') {
    return (left, right) => left.name.localeCompare(right.name, 'id');
  }
  return (left, right) =>
    right.episodes - left.episodes || left.name.localeCompare(right.name, 'id');
}

export function buildRows(
  stops: readonly StopSummary[],
  coverage: readonly CoverageSummaryItem[],
): BoardRow[] {
  const byStopId = new Map(coverage.map((item) => [item.stopId, item]));
  return stops.map((stop) => toRow(stop, byStopId.get(stop.id)));
}

export function viewRows(rows: readonly BoardRow[], filter: BoardFilter): BoardRow[] {
  const query = filter.q.trim();
  return rows
    .filter((row) => filter.level === 'all' || row.level === filter.level)
    .filter((row) => matchesQuery(row, query))
    .sort(compareBy(filter.sort));
}

export function summarizeRows(rows: readonly BoardRow[]): BoardTotals {
  let measured = 0;
  let withIndication = 0;
  let episodes = 0;
  for (const row of rows) {
    episodes += row.episodes;
    if (row.episodes > 0) {
      measured += 1;
    }
    if (row.level !== 'none') {
      withIndication += 1;
    }
  }
  return { listed: rows.length, measured, withIndication, episodes };
}