export interface PageMeta {
  title: string;
  description: string;
  noindex: boolean;
}

export const SITE_NAME = 'HADIR';
export const DEFAULT_TITLE = 'HADIR — Audit Kehadiran Layanan';
export const MAX_TITLE = 70;
export const MAX_DESCRIPTION = 160;

const PAGES: Readonly<Record<string, PageMeta>> = {
  '/': {
    title: 'Papan bukti tunggu bus',
    description:
      'Janji headway, jumlah episode, dan level bukti per halte. Halte tanpa data dibiarkan kosong, bukan diisi nol.',
    noindex: false,
  },
  '/peta': {
    title: 'Peta sebaran halte',
    description:
      'Skema posisi halte terdaftar beserta level bukti yang sudah tercatat, tanpa ubin peta pihak ketiga.',
    noindex: false,
  },
  '/sekitar': {
    title: 'Catat tanpa memindai stiker',
    description:
      'Cari halte di sekitar posisimu dan catat lama tunggu. Hanya kategori jarak dan akurasi yang dikirim, bukan titik presisi.',
    noindex: false,
  },
  '/scan': {
    title: 'Pindai QR halte',
    description:
      'QR di tiang halte membawa kode halte dan tanda tangan keasliannya. Kamu juga bisa memasukkan kode halte manual.',
    noindex: false,
  },
  '/s/$stopCode': {
    title: 'Halte',
    description:
      'Halaman halte: janji headway, estimasi tunggu dengan interval kepercayaan, dan tombol mulai mencatat.',
    noindex: false,
  },
  '/wait/$episodeId': {
    title: 'Tiket tunggu',
    description: 'Tiket tunggu aktif dengan penghitung waktu dan tombol hasil perjalanan.',
    noindex: true,
  },
  '/ringkasan/$episodeId': {
    title: 'Ringkasan episode',
    description: 'Durasi tunggu final dan konteks janji headway untuk episode ini.',
    noindex: true,
  },
  '/lapor': {
    title: 'Lapor masalah layanan',
    description:
      'Laporkan tunggu panjang, bus tidak datang, halte rusak, atau masalah aksesibilitas pada halte terdaftar.',
    noindex: false,
  },
  '/laporan/$publicId': {
    title: 'Detail laporan',
    description:
      'Status, riwayat, dan verifikasi penutupan sebuah laporan warga. Catatan internal instansi tidak ditampilkan di sini.',
    noindex: false,
  },
  '/koridor/$routeId': {
    title: 'Koridor',
    description: 'Daftar halte pada satu koridor beserta janji headway dan cakupan datanya.',
    noindex: false,
  },
  '/radar/$routeId': {
    title: 'Radar keberlanjutan',
    description:
      'Status pendanaan dan keputusan layanan satu koridor, dengan sumber dan tanggal dokumennya.',
    noindex: false,
  },
  '/metodologi': {
    title: 'Cara angka ini dihitung',
    description:
      'Definisi metrik, alasan n dan interval kepercayaan, batasan data, serta versi metode yang dipakai.',
    noindex: false,
  },
  '/transparansi/': {
    title: 'Anchor harian rantai laporan',
    description:
      'Akar Merkle harian dari rantai hash laporan, beserta penjelasan apa yang bisa dan belum bisa dibuktikan.',
    noindex: false,
  },
  '/transparansi/$date': {
    title: 'Anchor harian',
    description: 'Akar Merkle dan jumlah event pada satu tanggal, sebagai tujuan tautan verifikasi.',
    noindex: false,
  },
  '/privasi': {
    title: 'Privasi dan data saya',
    description:
      'Data apa yang dikumpulkan, apa yang tidak pernah dikirim, dan cara meminta penghapusan.',
    noindex: false,
  },
  '/masuk': {
    title: 'Masuk mitra',
    description:
      'Halaman masuk untuk petugas instansi yang sudah diundang. Tidak ada pendaftaran publik.',
    noindex: true,
  },
  '/partner': {
    title: 'Ringkasan mitra',
    description: 'Beban laporan instansimu pada rentang tertentu, dengan ambang kerahasiaan.',
    noindex: true,
  },
  '/partner/': {
    title: 'Ringkasan mitra',
    description: 'Beban laporan instansimu pada rentang tertentu, dengan ambang kerahasiaan.',
    noindex: true,
  },
  '/partner/laporan/': {
    title: 'Inbox laporan',
    description: 'Laporan yang masuk ke instansimu, dengan saringan status dan kategori.',
    noindex: true,
  },
  '/partner/laporan/$publicId': {
    title: 'Detail laporan mitra',
    description: 'Isi laporan, lampiran, riwayat, dan tindakan status untuk petugas instansi.',
    noindex: true,
  },
  '/partner/analitik': {
    title: 'Analitik mitra',
    description: 'Agregat laporan instansimu per rentang, dengan kelompok kecil disembunyikan.',
    noindex: true,
  },
  '/partner/ekspor': {
    title: 'Ekspor paket bukti',
    description:
      'Buat berkas CSV atau Open311 dari laporan instansimu, lalu unduh lewat tautan bertanda tangan.',
    noindex: true,
  },
  '/partner/pengaturan': {
    title: 'Pengaturan akun mitra',
    description: 'Kata sandi, passkey, dan sesi aktif untuk akun mitra instansi.',
    noindex: true,
  },
};

const UNKNOWN: PageMeta = {
  title: 'Halaman tidak dikenal',
  description: DEFAULT_TITLE,
  noindex: true,
};

export function pageMetaFor(fullPath: string | null | undefined): PageMeta | null {
  if (typeof fullPath !== 'string' || fullPath.length === 0) {
    return null;
  }
  const direct = PAGES[fullPath];
  if (direct !== undefined) {
    return direct;
  }
  const bare = fullPath.length > 1 && fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath;
  const trimmed = PAGES[bare];
  if (trimmed !== undefined) {
    return trimmed;
  }
  const slashed = PAGES[`${bare}/`];
  return slashed === undefined ? null : slashed;
}

export function documentTitle(meta: PageMeta | null): string {
  if (meta === null) {
    return DEFAULT_TITLE;
  }
  const composed = `${meta.title} · ${SITE_NAME}`;
  return composed.length <= MAX_TITLE ? composed : DEFAULT_TITLE;
}

export function robotsDirective(noindex: boolean): string {
  return noindex ? 'noindex, nofollow' : 'index, follow';
}

export function descriptionFor(meta: PageMeta | null): string {
  const source = meta === null ? UNKNOWN.description : meta.description;
  const trimmed = source.trim().replace(/\s+/gu, ' ');
  return trimmed.length <= MAX_DESCRIPTION ? trimmed : `${trimmed.slice(0, MAX_DESCRIPTION - 1)}…`;
}

export const KNOWN_PATHS: readonly string[] = Object.keys(PAGES);

export function isProtectedPath(fullPath: string): boolean {
  return fullPath === '/masuk' || fullPath === '/partner' || fullPath.startsWith('/partner/');
}