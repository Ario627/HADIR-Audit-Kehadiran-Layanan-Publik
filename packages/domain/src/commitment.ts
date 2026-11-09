import { excessThreshold } from './stats';

export type CommitmentKind = 'headway' | 'span' | 'reliability' | 'other';
export type CommitmentStatus = 'draft' | 'verified' | 'superseded' | 'revoked';
export type CommitmentDayScope = 'all' | 'weekday' | 'weekend' | 'holiday';
export type CommitmentSpecificity = 'stop' | 'route';

export interface CommitmentRecord {
  id: string;
  routeId: string | null;
  stopId: string | null;
  kind: CommitmentKind;
  dayScope: CommitmentDayScope;
  headwayMin: number | null;
  spanStart: string | null;
  spanEnd: string | null;
  sourceDocumentUrl: string;
  sourceDocumentTitle: string | null;
  sourceDocumentVersion: string | null;
  validFrom: string;
  validUntil: string | null;
  status: CommitmentStatus;
  verifiedAt: string | null;
  institutionName: string;
}

export type BenchmarkReason =
  | 'no_commitment'
  | 'not_verified'
  | 'outside_validity'
  | 'scope_mismatch'
  | 'missing_headway';

export interface BenchmarkQuery {
  routeId?: string | null;
  stopId?: string | null;
  onDate: string;
  dayScope?: CommitmentDayScope | null;
}

export interface ResolvedBenchmark {
  status: 'resolved';
  commitment: CommitmentRecord;
  specificity: CommitmentSpecificity;
  headwayMin: number;
  idealWaitMin: number;
  thresholdMin: number;
}

export interface UnavailableBenchmark {
  status: 'unavailable';
  reason: BenchmarkReason;
  message: string;
  considered: number;
}

export type Benchmark = ResolvedBenchmark | UnavailableBenchmark;

export interface CommitmentChange {
  validFrom: string;
  validUntil: string | null;
  headwayMin: number | null;
  sourceDocumentUrl: string;
  sourceDocumentVersion: string | null;
  supersededBy: string | null;
  days: number | null;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;
const SCOPE_RANK: Readonly<Record<CommitmentDayScope, number>> = Object.freeze({
  all: 0,
  weekend: 1,
  weekday: 1,
  holiday: 2,
});

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseDay(raw: string): Date | null {
  if (!DATE_PATTERN.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === raw ? parsed : null;
}

export function dayScopeForDate(date: string): CommitmentDayScope | null {
  const parsed = parseDay(date);
  if (parsed === null) {
    return null;
  }
  const weekday = parsed.getUTCDay();
  return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

function scopeMatches(
  declared: CommitmentDayScope,
  actual: CommitmentDayScope,
): boolean {
  if (declared === 'all') {
    return true;
  }
  if (declared === 'holiday') {
    return actual === 'holiday';
  }
  return declared === actual;
}

function coversDate(record: CommitmentRecord, date: string): boolean {
  const target = parseDay(date);
  const from = parseDay(record.validFrom);
  if (target === null || from === null) {
    return false;
  }
  if (target.getTime() < from.getTime()) {
    return false;
  }
  if (record.validUntil === null) {
    return true;
  }
  const until = parseDay(record.validUntil);
  return until !== null && target.getTime() <= until.getTime();
}

function specificityOf(record: CommitmentRecord): CommitmentSpecificity {
  return record.stopId !== null ? 'stop' : 'route';
}

function specificityRank(record: CommitmentRecord): number {
  return record.stopId !== null ? 2 : 1;
}

function matchesScope(
  record: CommitmentRecord,
  query: BenchmarkQuery,
  actualScope: CommitmentDayScope,
): boolean {
  if (query.stopId != null && record.stopId !== null && record.stopId === query.stopId) {
    return true;
  }
  if (query.routeId != null && record.routeId !== null && record.routeId === query.routeId) {
    return record.stopId === null;
  }
  return false;
}

interface Candidate {
  record: CommitmentRecord;
  rank: number;
}

function pickWinner(candidates: readonly Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  for (const candidate of candidates) {
    if (best === null) {
      best = candidate;
      continue;
    }
    if (candidate.rank > best.rank) {
      best = candidate;
      continue;
    }
    if (candidate.rank === best.rank) {
      const left = candidate.record.validFrom;
      const right = best.record.validFrom;
      if (left > right) {
        best = candidate;
      }
    }
  }
  return best;
}

export function unavailableMessage(reason: BenchmarkReason): string {
  switch (reason) {
    case 'no_commitment':
      return 'Belum ada dokumen janji layanan yang tercatat untuk rute atau halte ini.';
    case 'not_verified':
      return 'Ada dokumen janji layanan, tetapi belum diverifikasi. Angka target tidak dipakai.';
    case 'outside_validity':
      return 'Dokumen janji layanan yang tercatat tidak berlaku pada tanggal pengamatan ini.';
    case 'scope_mismatch':
      return 'Dokumen janji layanan hanya berlaku untuk hari atau jam yang berbeda dari pengamatan ini.';
    case 'missing_headway':
      return 'Dokumen janji layanan ada, tetapi tidak memuat angka headway yang bisa dibandingkan.';
  }
}

export function resolveBenchmark(
  records: readonly CommitmentRecord[],
  query: BenchmarkQuery,
): Benchmark {
  const scope = query.dayScope ?? dayScopeForDate(query.onDate);
  if (scope === null) {
    return {
      status: 'unavailable',
      reason: 'outside_validity',
      message: 'Tanggal pengamatan tidak valid.',
      considered: 0,
    };
  }
  if (query.routeId == null && query.stopId == null) {
    return {
      status: 'unavailable',
      reason: 'no_commitment',
      message: 'Tidak ada rute atau halte yang ditanyakan.',
      considered: 0,
    };
  }

  const relevant = records.filter(
    (record) =>
      record.kind === 'headway' &&
      matchesScope(record, query, scope) &&
      scopeMatches(record.dayScope, scope),
  );

  const verified = relevant.filter((record) => record.status === 'verified');
  if (verified.length === 0) {
    return {
      status: 'unavailable',
      reason: relevant.length === 0 ? 'no_commitment' : 'not_verified',
      message: unavailableMessage(relevant.length === 0 ? 'no_commitment' : 'not_verified'),
      considered: relevant.length,
    };
  }

  const inForce = verified.filter((record) => coversDate(record, query.onDate));
  if (inForce.length === 0) {
    return {
      status: 'unavailable',
      reason: 'outside_validity',
      message: unavailableMessage('outside_validity'),
      considered: verified.length,
    };
  }

  const withHeadway = inForce.filter(
    (record) => record.headwayMin !== null && record.headwayMin > 0,
  );
  if (withHeadway.length === 0) {
    return {
      status: 'unavailable',
      reason: 'missing_headway',
      message: unavailableMessage('missing_headway'),
      considered: inForce.length,
    };
  }

  const candidates: Candidate[] = withHeadway.map((record) => ({
    record,
    rank: specificityRank(record) * 10 + SCOPE_RANK[record.dayScope],
  }));
  const winner = pickWinner(candidates);
  if (winner === null) {
    return {
      status: 'unavailable',
      reason: 'scope_mismatch',
      message: unavailableMessage('scope_mismatch'),
      considered: inForce.length,
    };
  }

  const headwayMin = winner.record.headwayMin!;
  return {
    status: 'resolved',
    commitment: winner.record,
    specificity: specificityOf(winner.record),
    headwayMin,
    idealWaitMin: round1(headwayMin / 2),
    thresholdMin: excessThreshold(headwayMin) ?? round1(headwayMin / 2),
  };
}

export function benchmarkMessage(benchmark: Benchmark): string {
  if (benchmark.status === 'unavailable') {
    return `Benchmark tidak tersedia. ${benchmark.message}`;
  }
  return `Janji layanan ${benchmark.headwayMin} menit → tunggu ideal ${benchmark.idealWaitMin} menit, ambang ${benchmark.thresholdMin} menit (${benchmark.specificity === 'stop' ? 'per halte' : 'per rute'}).`;
}

export function resolveBenchmarkForStop(
  records: readonly CommitmentRecord[],
  stopId: string,
  routeId: string | null,
  onDate: string,
): Benchmark {
  return resolveBenchmark(records, {
    stopId,
    routeId,
    onDate,
  });
}

function daysBetween(from: string, until: string | null, today: string): number | null {
  const start = parseDay(from);
  const end = until === null ? parseDay(today) : parseDay(until);
  if (start === null || end === null) {
    return null;
  }
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);
}

export function commitmentChanges(
  records: readonly CommitmentRecord[],
  today: string,
): readonly CommitmentChange[] {
  return records
    .filter((record) => record.status === 'verified')
    .slice()
    .sort((left, right) => {
      if (left.validFrom !== right.validFrom) {
        return left.validFrom < right.validFrom ? 1 : -1;
      }
      return left.id < right.id ? 1 : -1;
    })
    .map((record) => ({
      validFrom: record.validFrom,
      validUntil: record.validUntil,
      headwayMin: record.headwayMin,
      sourceDocumentUrl: record.sourceDocumentUrl,
      sourceDocumentVersion: record.sourceDocumentVersion,
      supersededBy: null,
      days: daysBetween(record.validFrom, record.validUntil, today),
    }));
}

export function describeCommitment(record: CommitmentRecord): string {
  const scopeLabel: Readonly<Record<CommitmentDayScope, string>> = {
    all: 'semua hari',
    weekday: 'hari kerja',
    weekend: 'akhir pekan',
    holiday: 'hari libur',
  };
  const target =
    record.headwayMin === null
      ? 'tanpa angka headway'
      : `headway ${record.headwayMin} menit`;
  const validity =
    record.validUntil === null
      ? `berlaku sejak ${record.validFrom}`
      : `berlaku ${record.validFrom} sampai ${record.validUntil}`;
  const version =
    record.sourceDocumentVersion === null
      ? ''
      : `, versi dokumen ${record.sourceDocumentVersion}`;
  return `${record.institutionName}: ${target} untuk ${scopeLabel[record.dayScope]}, ${validity}${version}.`;
}

export function commitmentCaveats(): readonly string[] {
  return Object.freeze([
    'Target headway berasal dari dokumen resmi yang diverifikasi, bukan dari rata-rata pengamatan.',
    'Hari libur nasional tidak dikenali otomatis; janji layanan khusus hari libur hanya dipakai jika kalender hari libur diberikan eksplisit.',
    'Jika dokumen berubah, pengamatan lama tetap memakai dokumen yang berlaku pada tanggalnya, bukan dokumen terbaru.',
    'Tanpa dokumen yang sah, sistem menulis "benchmark tidak tersedia" dan tidak mengarang angka standar.',
  ]);
}

export function validOn(record: CommitmentRecord, date: string): boolean {
  return record.status === 'verified' && coversDate(record, date);
}

export function overlappingCommitmentIds(
  records: readonly CommitmentRecord[],
): readonly (readonly [string, string])[] {
  const verified = records.filter((record) => record.status === 'verified');
  const pairs: [string, string][] = [];
  for (let left = 0; left < verified.length; left += 1) {
    for (let right = left + 1; right < verified.length; right += 1) {
      const a = verified[left]!;
      const b = verified[right]!;
      const sameTarget =
        (a.routeId ?? '') === (b.routeId ?? '') &&
        (a.stopId ?? '') === (b.stopId ?? '') &&
        a.kind === b.kind &&
        a.dayScope === b.dayScope;
      if (!sameTarget) {
        continue;
      }
      const aStart = parseDay(a.validFrom);
      const bStart = parseDay(b.validFrom);
      const aEnd = a.validUntil === null ? null : parseDay(a.validUntil);
      const bEnd = b.validUntil === null ? null : parseDay(b.validUntil);
      if (aStart === null || bStart === null) {
        continue;
      }
      const aEndsAt = aEnd === null ? Number.POSITIVE_INFINITY : aEnd.getTime();
      const bEndsAt = bEnd === null ? Number.POSITIVE_INFINITY : bEnd.getTime();
      if (aStart.getTime() <= bEndsAt && bStart.getTime() <= aEndsAt) {
        pairs.push([a.id, b.id]);
      }
    }
  }
  return pairs;
}
