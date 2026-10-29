import type { Methodology } from '@hadir/contracts';

export interface ChangelogEntry {
  version: string;
  updatedAt: string;
  summary: string;
}

export interface TransparencySection {
  id: string;
  title: string;
  body: string;
  available: boolean;
}

const DAY_MS = 86_400_000;
const MAX_SUMMARY = 400;

export type ChangelogSource = Pick<
  Methodology,
  'methodVersion' | 'updatedAt' | 'steps' | 'limitations'
>;

export function changelogOf(methodology: ChangelogSource): ChangelogEntry[] {
  if (Number.isNaN(Date.parse(methodology.updatedAt))) {
    return [];
  }
  return [
    {
      version: methodology.methodVersion,
      updatedAt: methodology.updatedAt,
      summary: summaryOf(methodology),
    },
  ];
}

function summaryOf(methodology: Pick<ChangelogSource, 'steps' | 'limitations'>): string {
  const text = `${methodology.steps.length} langkah perhitungan dan ${methodology.limitations.length} batasan data pada versi ini.`;
  return text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1)}…`;
}

export function versionAgeText(updatedAt: string, now: number): string {
  const at = Date.parse(updatedAt);
  if (Number.isNaN(at)) {
    return 'tanggal versi tidak terbaca';
  }
  const days = Math.floor((now - at) / DAY_MS);
  if (!Number.isFinite(days) || days < 0) {
    return 'tanggal versi tidak terbaca';
  }
  if (days === 0) {
    return 'diperbarui hari ini';
  }
  if (days === 1) {
    return 'diperbarui kemarin';
  }
  return `diperbarui ${days} hari lalu`;
}

export function correctionPolicy(): string {
  return 'Hasil episode hanya bisa dikoreksi selama jendela koreksi yang ditetapkan server, yaitu batas waktu episode sebelum ditutup otomatis. Setiap koreksi tercatat sebagai event corrected dengan penanda late_correction bila melewati batas analisis, dan hasil cancelled tidak bisa dikoreksi sama sekali.';
}

export function correctionSection(): TransparencySection {
  return {
    id: 'koreksi',
    title: 'Log koreksi',
    body: 'Koreksi individual tampil pada riwayat episode dan riwayat laporan terkait. Daftar koreksi gabungan lintas episode belum tersedia karena API publik belum memiliki endpoint-nya, jadi halaman ini tidak menampilkannya.',
    available: false,
  };
}

export function downloadSection(): TransparencySection {
  return {
    id: 'unduhan',
    title: 'Data unduhan',
    body: 'Unduhan massal untuk publik belum tersedia; yang ada adalah ekspor khusus instansi mitra. Data publik tetap bisa dibaca per halaman: papan bukti, peta halte, detail tiap laporan, dan metodologi. Semua halaman itu boleh disalin atau dicetak.',
    available: false,
  };
}

export function contactSection(): TransparencySection {
  return {
    id: 'kontak',
    title: 'Kontak',
    body: 'Kontak pengawas data dan pejabat perlindungan data belum ditetapkan. Menampilkan alamat surel yang belum diverifikasi lebih buruk daripada mengaku belum ada, jadi bagian ini dikosongkan sampai kontaknya resmi.',
    available: false,
  };
}

export const TRANSPARENCY_SECTIONS: readonly TransparencySection[] = [
  correctionSection(),
  downloadSection(),
  contactSection(),
];