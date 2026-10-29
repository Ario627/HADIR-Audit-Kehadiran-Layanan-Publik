import { createHash } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { env } from '../common/config/env';
import { closeDatabase, db } from './client';
import {
  authorityMap,
  cities,
  devices,
  institutions,
  routeStops,
  routes,
  stops,
  waitEpisodes,
} from './schema';

interface StopSpec {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

interface RouteSpec {
  code: string;
  name: string;
  headwayMin: number;
}

type SeedStartMode = 'qr' | 'gps_nearby' | 'manual';
type SeedOutcome = 'boarded' | 'abandoned' | 'passed_full' | 'cancelled';
type SeedPresence = 'qr_only' | 'qr_geo' | 'gps_verified' | 'unverified';
type SeedDistance = '0-50' | '50-100' | null;
type SeedAccuracy = '<=20' | '21-50' | null;

const STOP_SPECS: readonly StopSpec[] = [
  { code: 'BMS-A12', name: 'Halte UMP', lat: -7.4112, lon: 109.2418 },
  { code: 'BMS-A13', name: 'Halte Kampus Selatan', lat: -7.4141, lon: 109.2431 },
  { code: 'BMS-B04', name: 'Halte Bank Jateng', lat: -7.424, lon: 109.238 },
  { code: 'BMS-B05', name: 'Halte Alun-Alun', lat: -7.405, lon: 109.245 },
  { code: 'BMS-C07', name: 'Halte Pasar Wage', lat: -7.4175, lon: 109.2362 },
  { code: 'BMS-C08', name: 'Halte Terminal Purwokerto', lat: -7.4312, lon: 109.2298 },
  { code: 'BMS-D02', name: 'Halte Stasiun Purwokerto', lat: -7.4198, lon: 109.2222 },
  { code: 'BMS-D03', name: 'Halte GOR Satria', lat: -7.4275, lon: 109.2471 },
  { code: 'BMS-E11', name: 'Halte RSUD Banyumas', lat: -7.4382, lon: 109.251 },
  { code: 'BMS-E12', name: 'Halte Universitas Jenderal Soedirman', lat: -7.4055, lon: 109.256 },
  { code: 'BMS-F06', name: 'Halte Pasar Manis', lat: -7.4189, lon: 109.252 },
  { code: 'BMS-F07', name: 'Halte Taman Kota', lat: -7.408, lon: 109.233 },
];

const ROUTE_SPECS: readonly RouteSpec[] = [
  { code: 'K3A', name: 'Terminal - Kampus', headwayMin: 15 },
  { code: 'K4', name: 'Alun-Alun - Stasiun', headwayMin: 20 },
];

interface InstitutionSpec {
  name: string;
  kind: 'dinhub' | 'pupr';
  site: string;
}

const INSTITUTION_SPECS: readonly InstitutionSpec[] = [
  { name: 'Dinhub Banyumas', kind: 'dinhub', site: 'https://dinhub.banyumaskab.go.id' },
  { name: 'PUPR Banyumas', kind: 'pupr', site: 'https://pupr.banyumaskab.go.id' },
];

const FOREIGN_STOP_CODES: readonly string[] = ['BMS-E11'];

const EPISODE_COUNT = 1_260;
const DEVICE_COUNT = 24;
const SPREAD_DAYS = 27;
const FIRST_HOUR = 6;
const LAST_HOUR = 19;

function seedHash(label: string): string {
  return createHash('sha256').update(`hadir.seed.v1|${label}`).digest('hex');
}

function seedUnit(label: string): number {
  const bytes = createHash('sha256').update(`hadir.seed.unit.v1|${label}`).digest();
  return bytes.readUInt32BE(0) / 0x1_0000_0000;
}

function seedUuid(label: string): string {
  const bytes = createHash('sha256').update(`hadir.seed.uuid.v1|${label}`).digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x70, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function startedAtFor(dayOffset: number, hour: number, minute: number, now: Date): Date {
  const value = new Date(now);
  value.setUTCDate(value.getUTCDate() - dayOffset);
  value.setUTCHours(hour, minute, 0, 0);
  if (value.getTime() > now.getTime()) {
    value.setUTCDate(value.getUTCDate() - 1);
  }
  return value;
}

function durationFor(index: number, outcome: SeedOutcome): number {
  if (outcome === 'boarded') return 300 + ((index * 137) % 1_500);
  if (outcome === 'abandoned') return 600 + ((index * 191) % 2_100);
  if (outcome === 'passed_full') return 480 + ((index * 173) % 1_620);
  return 60 + ((index * 53) % 240);
}

function startModeFor(index: number): SeedStartMode {
  if (index % 3 === 0) return 'qr';
  if (index % 3 === 1) return 'gps_nearby';
  return 'manual';
}

function presenceFor(
  index: number,
  startMode: SeedStartMode,
): { presence: SeedPresence; trustWeight: number; distance: SeedDistance; accuracy: SeedAccuracy } {
  if (startMode === 'qr') {
    if (index % 2 === 0) {
      return {
        presence: 'qr_geo',
        trustWeight: 0.9,
        distance: '0-50',
        accuracy: '<=20',
      };
    }
    return { presence: 'qr_only', trustWeight: 0.7, distance: null, accuracy: null };
  }
  if (startMode === 'gps_nearby') {
    if (index % 4 === 0) {
      return {
        presence: 'gps_verified',
        trustWeight: 0.85,
        distance: '0-50',
        accuracy: '<=20',
      };
    }
    return {
      presence: 'unverified',
      trustWeight: 0.6,
      distance: '50-100',
      accuracy: '21-50',
    };
  }
  return { presence: 'unverified', trustWeight: 0.55, distance: null, accuracy: null };
}

function outcomeFor(index: number): SeedOutcome {
  const slot = index % 20;
  if (slot < 14) return 'boarded';
  if (slot < 17) return 'abandoned';
  if (slot < 19) return 'passed_full';
  return 'cancelled';
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

async function main(): Promise<void> {
  if (env.isProduction) {
    throw new Error('Seed demo tidak boleh dijalankan di production.');
  }

  const now = new Date();

  const cityRows = await db
    .insert(cities)
    .values({ code: 'BMS', name: 'Kabupaten Banyumas', timezone: 'Asia/Jakarta' })
    .onConflictDoUpdate({
      target: cities.code,
      set: { name: 'Kabupaten Banyumas', timezone: 'Asia/Jakarta' },
    })
    .returning({ id: cities.id });
  const city = cityRows[0];
  if (city === undefined) {
    throw new Error('Kota seed gagal dibuat.');
  }

  const routeRows: { id: string; spec: RouteSpec }[] = [];
  for (const spec of ROUTE_SPECS) {
    const rows = await db
      .insert(routes)
      .values({
        cityId: city.id,
        code: spec.code,
        name: spec.name,
        mode: 'feeder',
        promisedHeadwayPeakMin: spec.headwayMin,
        promisedHeadwayOffMin: spec.headwayMin + 5,
        status: 'active',
      })
      .onConflictDoUpdate({
        target: [routes.cityId, routes.code],
        set: {
          name: spec.name,
          promisedHeadwayPeakMin: spec.headwayMin,
          promisedHeadwayOffMin: spec.headwayMin + 5,
          status: 'active',
        },
      })
      .returning({ id: routes.id });
    const route = rows[0];
    if (route === undefined) {
      throw new Error(`Koridor ${spec.code} gagal dibuat.`);
    }
    routeRows.push({ id: route.id, spec });
  }

  const stopRows: { id: string; spec: StopSpec }[] = [];
  for (const spec of STOP_SPECS) {
    const rows = await db
      .insert(stops)
      .values({
        cityId: city.id,
        code: spec.code,
        name: spec.name,
        geom: sql`ST_SetSRID(ST_MakePoint(${spec.lon}, ${spec.lat}), 4326)::geography`,
        geofenceRadiusM: 150,
        status: 'active',
        isDemo: true,
      })
      .onConflictDoUpdate({
        target: [stops.cityId, stops.code],
        set: {
          name: spec.name,
          geom: sql`ST_SetSRID(ST_MakePoint(${spec.lon}, ${spec.lat}), 4326)::geography`,
          geofenceRadiusM: 150,
          status: 'active',
          isDemo: true,
        },
      })
      .returning({ id: stops.id });
    const stop = rows[0];
    if (stop === undefined) {
      throw new Error(`Halte ${spec.code} gagal dibuat.`);
    }
    stopRows.push({ id: stop.id, spec });
  }

  for (const route of routeRows) {
    const values = stopRows.map((stop, index) => ({
      routeId: route.id,
      stopId: stop.id,
      direction: 0,
      seq: index,
    }));
    await db.insert(routeStops).values(values).onConflictDoNothing();
  }

  const institutionRows: { id: string; spec: InstitutionSpec }[] = [];
  for (const spec of INSTITUTION_SPECS) {
    const existing = await db
      .select({ id: institutions.id })
      .from(institutions)
      .where(and(eq(institutions.cityId, city.id), eq(institutions.name, spec.name)))
      .limit(1);
    const created =
      existing[0] ??
      (
        await db
          .insert(institutions)
          .values({
            cityId: city.id,
            name: spec.name,
            kind: spec.kind,
            officialSiteUrl: spec.site,
          })
          .returning({ id: institutions.id })
      )[0];
    if (created === undefined) {
      throw new Error(`Institusi ${spec.name} gagal dibuat.`);
    }
    institutionRows.push({ id: created.id, spec });
  }

  const pilot = institutionRows.find((row) => row.spec.kind === 'dinhub');
  const foreign = institutionRows.find((row) => row.spec.kind === 'pupr');
  if (pilot === undefined || foreign === undefined) {
    throw new Error('Institusi seed tidak lengkap.');
  }
  for (const stop of stopRows) {
    const owner = FOREIGN_STOP_CODES.includes(stop.spec.code) ? foreign : pilot;
    await db
      .insert(authorityMap)
      .values({
        cityId: city.id,
        assetKind: 'stop',
        assetRef: stop.spec.code,
        institutionId: owner.id,
        sourceUrl: 'https://contoh.go.id/kewenangan-aset',
        verified: owner === pilot,
        note: owner === pilot ? null : 'Contoh pemetaan lintas instansi untuk mode demo',
      })
      .onConflictDoUpdate({
        target: [authorityMap.cityId, authorityMap.assetKind, authorityMap.assetRef],
        set: { institutionId: owner.id, verified: owner === pilot },
      });
  }

  const deviceHashes = Array.from({ length: DEVICE_COUNT }, (_, index) =>
    seedHash(`device|${index}`),
  );
  await db
    .insert(devices)
    .values(deviceHashes.map((deviceHash) => ({ deviceHash })))
    .onConflictDoNothing();

  await db
    .delete(waitEpisodes)
    .where(
      and(
        inArray(waitEpisodes.deviceHash, deviceHashes),
        sql`'simulated' = ANY(${waitEpisodes.qualityFlags})`,
      ),
    );

  const episodeRows = Array.from({ length: EPISODE_COUNT }, (_, index) => {
    const outcome = outcomeFor(index);
    const startMode = startModeFor(index);
    const durationS = durationFor(index, outcome);
    const stopSlot = Math.floor(stopRows.length * seedUnit(`stop|${index}`) ** 1.7);
    const stop = stopRows[Math.min(stopSlot, stopRows.length - 1)];
    const hour = FIRST_HOUR + Math.floor(seedUnit(`hour|${index}`) * (LAST_HOUR - FIRST_HOUR));
    const startedAt = startedAtFor(
      Math.floor(seedUnit(`day|${index}`) * SPREAD_DAYS),
      hour,
      Math.floor(seedUnit(`minute|${index}`) * 60),
      now,
    );
    const endedAt = new Date(startedAt.getTime() + durationS * 1_000);
    const presence = presenceFor(index, startMode);
    const route = routeRows[index % routeRows.length];
    const deviceSlot = Math.floor(seedUnit(`device|${index}`) * DEVICE_COUNT);
    if (stop === undefined || route === undefined) {
      throw new Error('Data halte atau koridor seed tidak lengkap.');
    }
    return {
      id: seedUuid(`episode|${index}`),
      stopId: stop.id,
      routeId: route.id,
      startMode,
      presence: presence.presence,
      outcome,
      startedAt,
      endedAt,
      clientStartedAt: startedAt,
      clientEndedAt: endedAt,
      clockSkewMs: 0,
      timeSource: 'server' as const,
      deviceHash: deviceHashes[deviceSlot] ?? seedHash('device|0'),
      deviceDayHash: seedHash(
        `device-day|${deviceSlot}|${startedAt.toISOString().slice(0, 10)}`,
      ),
      clientEventId: seedUuid(`episode-client-event|${index}`),
      qrEpoch: startMode === 'qr' ? '202610' : null,
      qrKeyId: startMode === 'qr' ? 'k1' : null,
      distanceBucket: presence.distance,
      accuracyBucket: presence.accuracy,
      geoOk: presence.presence === 'qr_geo' || presence.presence === 'gps_verified',
      trustWeight: presence.trustWeight,
      qualityFlags: ['simulated'],
      note: null,
    };
  });

  for (const batch of chunks(episodeRows, 50)) {
    await db.insert(waitEpisodes).values(batch).onConflictDoNothing();
  }

  console.log(
    `Seed selesai: ${stopRows.length} halte, ${routeRows.length} koridor, ${episodeRows.length} episode simulasi.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(`Seed gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
