import { isApiError } from './api';

export type ErrorAction = 'retry' | 'board' | 'resume' | 'none';

export interface ErrorMessage {
  title: string;
  detail: string;
  action: ErrorAction;
}

const UNKNOWN: ErrorMessage = {
  title: 'Permintaan gagal',
  detail: 'Coba lagi. Jika berulang, laporkan tanpa menyertakan data pribadi.',
  action: 'retry',
};

const BY_CODE = new Map<string, ErrorMessage>([
  [
    'QR_INVALID',
    {
      title: 'QR tidak dikenali',
      detail: 'Tanda tangan pada QR tidak cocok. Kamu tetap bisa memilih halte manual.',
      action: 'board',
    },
  ],
  [
    'QR_EXPIRED',
    {
      title: 'Stiker ini sudah kedaluwarsa',
      detail: 'Kunci QR sudah diganti. Pilih halte manual; catatanmu tetap dihitung.',
      action: 'board',
    },
  ],
  [
    'STOP_INACTIVE',
    {
      title: 'Halte sedang tidak aktif',
      detail: 'Halte ini tidak menerima pengukuran saat ini. Pilih halte lain di papan bukti.',
      action: 'board',
    },
  ],
  [
    'EPISODE_ALREADY_ACTIVE',
    {
      title: 'Masih ada episode yang berjalan',
      detail: 'Satu perangkat hanya boleh mencatat satu episode. Selesaikan dulu yang aktif.',
      action: 'resume',
    },
  ],
  [
    'INVALID_TRANSITION',
    {
      title: 'Episode sudah selesai',
      detail: 'Tidak ada yang perlu disimpan lagi. Hasil episode ini bisa dilihat di ringkasan.',
      action: 'none',
    },
  ],
  [
    'IDEMPOTENCY_CONFLICT',
    {
      title: 'Permintaan berbeda dengan yang tercatat',
      detail: 'Permintaan sebelumnya dengan kunci sama sudah tersimpan dengan isi berbeda.',
      action: 'retry',
    },
  ],
  [
    'UNAUTHENTICATED',
    {
      title: 'Perangkat belum terdaftar',
      detail: 'Muat ulang halaman agar perangkat ini terdaftar ulang.',
      action: 'retry',
    },
  ],
  [
    'VALIDATION_FAILED',
    {
      title: 'Data tidak lolos pemeriksaan',
      detail: 'Periksa kembali isian yang ditandai, lalu coba lagi.',
      action: 'none',
    },
  ],
  [
    'NOT_FOUND',
    {
      title: 'Tidak ditemukan',
      detail: 'Data ini tidak ada atau bukan milik perangkat ini.',
      action: 'board',
    },
  ],
  [
    'NETWORK_ERROR',
    {
      title: 'Tidak bisa menghubungi server',
      detail: 'Periksa koneksi. Catatan di perangkat ini tidak hilang.',
      action: 'retry',
    },
  ],
  [
    'TIMEOUT',
    {
      title: 'Server tidak menjawab tepat waktu',
      detail: 'Permintaan terlalu lama. Coba lagi sebentar lagi.',
      action: 'retry',
    },
  ],
  [
    'CONTRACT_MISMATCH',
    {
      title: 'Respons server tidak dikenali',
      detail: 'Versi aplikasi mungkin tertinggal dari server. Muat ulang halaman.',
      action: 'retry',
    },
  ],
  [
    'SERVICE_UNAVAILABLE',
    {
      title: 'Layanan sedang tidak tersedia',
      detail: 'Coba lagi beberapa saat lagi.',
      action: 'retry',
    },
  ],
]);

function rateLimited(error: { retryAfterSeconds: number | null }): ErrorMessage {
  const seconds = error.retryAfterSeconds;
  return {
    title: 'Terlalu banyak percobaan',
    detail:
      seconds === null
        ? 'Tunggu sebentar sebelum mencoba lagi.'
        : `Coba lagi dalam ${seconds} detik. Batas ini melindungi data dari catatan ganda.`,
    action: 'none',
  };
}

export function describeError(error: unknown): ErrorMessage {
  if (!isApiError(error)) {
    return UNKNOWN;
  }
  if (error.code === 'RATE_LIMITED') {
    return rateLimited(error);
  }
  const known = BY_CODE.get(error.code);
  if (known !== undefined) {
    return known;
  }
  return { title: UNKNOWN.title, detail: error.message, action: UNKNOWN.action };
}