export interface EpisodeForStats {
  durationS: number | null;
  outcome: string | null;
}

export interface WaitStats {
  n: number;
  medianMin: number | null;
  p95Min: number | null;
  meanMin: number | null;
  abandonRate: number | null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0 || !Number.isFinite(p) || p < 0 || p > 100) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? null;
}

export function summarizeEpisodes(episodes: readonly EpisodeForStats[]): WaitStats {
  const valid = episodes.filter(
    (episode) =>
      episode.outcome !== 'cancelled' &&
      episode.durationS !== null &&
      episode.durationS >= 30,
  );
  if (valid.length === 0) {
    return { n: 0, medianMin: null, p95Min: null, meanMin: null, abandonRate: null };
  }
  const minutes = valid
    .map((episode) => (episode.durationS ?? 0) / 60)
    .slice()
    .sort((left, right) => left - right);
  const mean = minutes.reduce((sum, value) => sum + value, 0) / minutes.length;
  const abandoned = valid.filter(
    (episode) => episode.outcome === 'abandoned' || episode.outcome === 'passed_full',
  ).length;
  return {
    n: valid.length,
    medianMin: round1(percentile(minutes, 50) ?? 0),
    p95Min: round1(percentile(minutes, 95) ?? 0),
    meanMin: round1(mean),
    abandonRate: Math.round((abandoned / valid.length) * 100) / 100,
  };
}

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const seconds = safe % 60;
  const pad = (value: number): string => value.toString().padStart(2, '0');
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

export function formatDurationMinutes(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  if (hours > 0) {
    return `${hours} j ${minutes.toString().padStart(2, '0')} mnt`;
  }
  return `${minutes} mnt`;
}

export function excessThreshold(headwayMin: number | null): number | null {
  if (headwayMin === null || !Number.isFinite(headwayMin) || headwayMin <= 0) {
    return null;
  }
  return Math.round(1.25 * (headwayMin / 2) * 1_000) / 1_000;
}