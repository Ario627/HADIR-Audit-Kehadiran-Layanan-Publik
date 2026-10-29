import type { TriageVerdict } from '@hadir/domain';

export interface TriageCopy {
  headline: string;
  body: string;
}

const COPY: Record<TriageVerdict, TriageCopy> = {
  join: {
    headline: 'Laporan serupa sudah ada',
    body: 'Warga lain sudah melaporkan hal yang sama di sekitar halte ini. Dukunganmu dicatat sebagai bukti tambahan, bukan laporan baru.',
  },
  already_planned: {
    headline: 'Sudah ada rencana resmi',
    body: 'Ada dokumen perencanaan tingkat tinggi yang terkait dengan halte ini. Belum tentu sudah dikerjakan, jadi tetap bisa dipantau.',
  },
  wrong_authority: {
    headline: 'Bukan kewenangan instansi ini',
    body: 'Aset ini tercatat di bawah instansi lain. Laporan bisa dikirim ke alamat yang benar agar tidak tertahan.',
  },
  service_not_running: {
    headline: 'Layanan tidak berjalan',
    body: 'Radar keberlanjutan mencatat layanan tidak beroperasi pada periode ini, sehingga tunggu yang panjang bukan kelalaian jadwal.',
  },
  data_supports: {
    headline: 'Pengukuran warga mendukung',
    body: 'Ada pengukuran di halte ini yang menunjukkan lama tunggu di atas janji. Laporanmu menambah konteks pada angka tersebut.',
  },
  data_insufficient: {
    headline: 'Data belum cukup',
    body: 'Pengukuran di halte ini masih terlalu sedikit untuk menyimpulkan. Laporanmu tetap berguna, dan mencatat tunggu akan membantu.',
  },
  new_report: {
    headline: 'Laporan baru',
    body: 'Belum ada laporan serupa, rencana resmi, atau pengukuran yang cukup di halte ini. Laporanmu akan menjadi yang pertama.',
  },
};

export function copyFor(verdict: TriageVerdict): TriageCopy {
  return COPY[verdict];
}
