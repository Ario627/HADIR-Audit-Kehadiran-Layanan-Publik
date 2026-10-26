import { Controller, Get, Header } from '@nestjs/common';
import { estimatorCriteria } from '@hadir/domain';
import { env } from '../../common/config/env';
import { RateLimit, RATE_LIMIT_POLICIES } from '../../common/http/rate-limit.policy';

const META_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';
const THRESHOLD_MULTIPLIER = 1.25;
const WINDOWS = ['7d', '30d'] as const;

const LEVELS = [
  {
    level: 'none',
    label: 'Belum cukup data',
    requirement: `n < ${estimatorCriteria.minN} atau klaster < ${estimatorCriteria.minClusters}`,
  },
  {
    level: 'indication',
    label: 'Indikasi',
    requirement: `n >= ${estimatorCriteria.minN}; batas bawah CI belum melewati ambang, atau janji headway tidak diketahui`,
  },
  {
    level: 'strong',
    label: 'Bukti kuat',
    requirement: `n >= ${estimatorCriteria.strongN}, hari >= ${estimatorCriteria.strongDays}, perangkat >= ${estimatorCriteria.strongDevices}, klaster >= ${estimatorCriteria.strongClusters}, batas bawah CI di atas ambang`,
  },
  {
    level: 'field_verified',
    label: 'Terverifikasi lapangan',
    requirement: 'Syarat bukti kuat terpenuhi dan ada konfirmasi pengamat terlatih',
  },
] as const;

const DIRECTIONS = [
  {
    direction: 'excess',
    label: 'Kelebihan tunggu terdeteksi',
    condition: 'Batas bawah CI 90% di atas ambang',
  },
  {
    direction: 'no_excess',
    label: 'Tidak ada kelebihan yang terdeteksi',
    condition: 'Seluruh CI 90% di bawah ambang; bukan bukti kepatuhan penuh',
  },
  {
    direction: 'inconclusive',
    label: 'Belum cukup untuk menyimpulkan',
    condition: 'CI memuat ambang, atau sampel belum memenuhi syarat minimum',
  },
] as const;

const WARNINGS = [
  { code: 'no_data', meaning: 'Tidak ada episode layak pada jendela waktu tersebut.' },
  { code: 'small_n', meaning: 'Jumlah episode di bawah syarat minimum untuk menyimpulkan.' },
  { code: 'small_cluster_count', meaning: 'Klaster hari-jam kurang dari tiga; interval terlalu lebar.' },
  { code: 'clustered_data', meaning: 'Design effect di atas dua; informasi efektif lebih kecil dari jumlah episode.' },
  { code: 'p95_unstable', meaning: 'Lebih dari 20% resample bootstrap tidak mencapai P95.' },
  { code: 'trust_sensitive', meaning: 'Membuang episode berkepercayaan rendah menggeser estimasi lebih dari 20%.' },
  { code: 'low_trust_dominant', meaning: 'Lebih dari 30% episode berasal dari kehadiran yang tidak terverifikasi.' },
  { code: 'bucket_capped', meaning: 'Jumlah bucket agregat mencapai batas; sampel dipotong.' },
  { code: 'timeout_inferred', meaning: 'Episode ditutup otomatis karena melewati batas waktu tunggu.' },
  { code: 'client_time', meaning: 'Durasi direkonstruksi dari jam perangkat setelah sinkronisasi offline.' },
  { code: 'duration_clamped', meaning: 'Klaim durasi perangkat melebihi waktu server dan dipotong.' },
  { code: 'late_correction', meaning: 'Episode yang ditutup otomatis kemudian dikoreksi pengguna dalam batas waktu.' },
  { code: 'simulated', meaning: 'Data simulasi; hanya tampil pada mode demo berlabel.' },
] as const;

const METHODOLOGY_STEPS = [
  {
    order: 1,
    title: 'Saring episode layak',
    detail:
      'Episode dibatalkan, berdurasi di bawah 30 detik, dan bertanda anomali klaster dikeluarkan. Episode simulasi hanya dipakai dalam mode demo.',
  },
  {
    order: 2,
    title: 'Bedakan dua estimand',
    detail:
      'Experienced wait menghitung semua akhir tunggu termasuk menyerah, dengan batas waktu analisis sebagai sensor. Time-to-board hanya menghitung boarding dan menyensor sisanya.',
  },
  {
    order: 3,
    title: 'Bangun fungsi survival',
    detail:
      'Kaplan-Meier dihitung dengan risk set sebelum setiap waktu, sehingga ties dan sensor tidak menggeser kurva.',
  },
  {
    order: 4,
    title: 'Hitung RMST dan persentil',
    detail:
      'Restricted mean survival time adalah luas di bawah kurva sampai batas waktu. P95 dilaporkan hanya jika kurva benar-benar turun melewatinya.',
  },
  {
    order: 5,
    title: 'Bootstrap berklaster',
    detail:
      'Klaster hari-jam diambil ulang dengan penggantian, lalu RMST dihitung pada setiap resample untuk membentuk interval persentil.',
  },
  {
    order: 6,
    title: 'Tentukan arah dan level',
    detail:
      'Arah ditentukan dari posisi seluruh interval terhadap ambang. Level bukti ditentukan dari jumlah, keragaman perangkat, jumlah klaster, dan design effect.',
  },
] as const;
const LIMITATIONS = [
  'Angka mencerminkan pengalaman penunggu yang mencatat, bukan seluruh penumpang.',
  'Halte tanpa data ditampilkan tanpa angka, bukan dengan angka nol.',
  'Sensor pada batas waktu analisis membuat RMST tidak pernah melebihi batas tersebut.',
  'Tanpa janji headway per koridor, level bukti maksimum adalah indikasi.',
  'Kehadiran fisik tidak dapat dibuktikan perangkat; bobot kepercayaan hanya dipakai sebagai analisis sensitivitas.',
] as const;

@Controller()
export class MetaController {
  @Get('meta')
  @Header('Cache-Control', META_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  meta() {
    return {
      name: 'HADIR API',
      version: '0.1.0',
      methodVersion: estimatorCriteria.methodVersion,
      tauMinutes: env.episodeTauMinutes,
      windows: WINDOWS,
      episode: {
        analysisTauMinutes: env.episodeTauMinutes,
        idleTimeoutMinutes: env.episodeIdleMinutes,
        absoluteMaxMinutes: env.episodeMaxMinutes,
        correctionWindowMinutes: env.episodeMaxMinutes,
        heartbeatIntervalSeconds: 60,
      },
      ci: {
        level: estimatorCriteria.ciLevel,
        method: 'cluster-bootstrap',
        iterations: 1_000,
      },
      criteria: {
        minN: estimatorCriteria.minN,
        minClusters: estimatorCriteria.minClusters,
        strongN: estimatorCriteria.strongN,
        strongDays: estimatorCriteria.strongDays,
        strongDevices: estimatorCriteria.strongDevices,
        strongClusters: estimatorCriteria.strongClusters,
        designEffectLimit: estimatorCriteria.designEffectLimit,
        ciLevel: estimatorCriteria.ciLevel,
        tauMinutes: env.episodeTauMinutes,
        thresholdMultiplier: THRESHOLD_MULTIPLIER,
      },
      levels: LEVELS,
      directions: DIRECTIONS,
      warnings: WARNINGS,
      privacy: {
        coordinatesStored: false,
        devicePseudonym:
          'Cookie perangkat ditandatangani dan di-hash harian; tidak ada akun, email, atau nomor telepon.',
        locationData:
          'Mode GPS hanya mengirim bucket jarak dan akurasi, bukan koordinat presisi.',
      },
      generatedAt: new Date().toISOString(),
    };
  }

  @Get('methodology')
  @Header('Cache-Control', META_CACHE)
  @RateLimit(RATE_LIMIT_POLICIES.stopsRead)
  methodology() {
    return {
      methodVersion: estimatorCriteria.methodVersion,
      updatedAt: '2026-10-26T00:00:00.000Z',
      primaryEstimand:
        'Experienced wait: lama tunggu yang dialami, termasuk yang berakhir karena menyerah atau bus penuh.',
      secondaryEstimand:
        'Time-to-board: lama tunggu jika semua penunggu bersedia menunggu sampai bus datang.',
      steps: METHODOLOGY_STEPS,
      clusterUnit: 'hari-jam per halte',
      clusterRationale:
        'Penunggu di halte dan jam yang sama cenderung menunggu bus yang sama, sehingga dianggap satu klaster agar interval tidak terlalu sempit.',
      thresholds: {
        excessMultiplier: THRESHOLD_MULTIPLIER,
        idealWaitFormula: 'headway / 2',
      },
      limitations: LIMITATIONS,
      generatedAt: new Date().toISOString(),
    };
  }
}