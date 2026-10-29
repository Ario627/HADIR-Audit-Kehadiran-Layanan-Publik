import { describe, expect, it } from 'vitest';
import {
  acceptsCorroboration,
  categoryHint,
  categoryLabel,
  checkReportText,
  eventLabel,
  isOwnReport,
  isTerminalStatus,
  moderationLabel,
  needsCitizenClosure,
  readPublicId,
  readReportCategory,
  rememberOwnReport,
  REPORT_CATEGORIES,
  REPORT_MAX_TEXT,
  REPORT_MIN_TEXT,
  CATEGORY_FIELD_ID,
  STOP_FIELD_ID,
  TEXT_FIELD_ID,
  reportFormIssues,
  sanitizeReportText,
  statusLabel,
  statusTone,
  warningText,
} from './report';

describe('sanitizeReportText', () => {
  it('merapikan spasi berlebih dan menghapus baris kosong', () => {
    expect(sanitizeReportText('  bus   tidak\n\n  datang  ')).toBe('bus tidak\ndatang');
  });

  it('membuang karakter kontrol tetapi mempertahankan baris baru', () => {
    expect(sanitizeReportText('a\u0000b\nc\u0007d')).toBe('ab\ncd');
  });

  it('mengembalikan string kosong untuk isi yang hanya spasi', () => {
    expect(sanitizeReportText('   \n\t\n  ')).toBe('');
  });
});

describe('checkReportText', () => {
  it('menolak teks pendek setelah dibersihkan, bukan sebelum', () => {
    const padded = `${' '.repeat(60)}bus datang`;
    expect(padded.length).toBeGreaterThan(REPORT_MIN_TEXT);
    expect(checkReportText(padded).issue).toBe('too_short');
  });

  it('menerima teks tepat pada ambang minimum', () => {
    const text = 'a'.repeat(REPORT_MIN_TEXT);
    expect(checkReportText(text)).toEqual({ text, length: REPORT_MIN_TEXT, issue: null });
  });

  it('menghitung panjang setelah sanitasi', () => {
    const check = checkReportText(`bus${' '.repeat(10)}tidak datang pagi ini`);
    expect(check.length).toBe('bus tidak datang pagi ini'.length);
    expect(check.issue).toBeNull();
  });

  it('membatasi panjang maksimum yang dipakai form', () => {
    expect(REPORT_MAX_TEXT).toBe(2_000);
  });
});

describe('label kategori dan status', () => {
  it('memberi label untuk semua kategori kontrak', () => {
    for (const category of REPORT_CATEGORIES) {
      expect(categoryLabel(category).length).toBeGreaterThan(0);
      expect(categoryHint(category).length).toBeGreaterThan(0);
    }
    expect(REPORT_CATEGORIES).toHaveLength(9);
  });

  it('menolak kategori di luar allowlist', () => {
    expect(readReportCategory('service_wait')).toBe('service_wait');
    expect(readReportCategory('bus_terlambat')).toBeNull();
    expect(readReportCategory('toString')).toBeNull();
    expect(readReportCategory(7)).toBeNull();
  });

  it('memberi label status yang bisa dibaca', () => {
    expect(statusLabel('submitted')).toBe('Terkirim');
    expect(statusLabel('claimed_resolved')).toBe('Diklaim selesai');
    expect(statusLabel('verified_resolved')).toBe('Selesai terverifikasi');
    expect(moderationLabel('quarantined')).toBe('Dikarantina');
  });

  it('memberi label tingkat bukti untuk setiap kategori', () => {
    for (const category of REPORT_CATEGORIES) {
      expect(categoryLabel(category).length).toBeGreaterThan(0);
    }
  });
});

describe('eventLabel', () => {
  it('menerjemahkan jenis event yang dikenal', () => {
    expect(eventLabel('submitted')).toBe('Laporan dikirim');
    expect(eventLabel('claimed_resolved')).toBe('Instansi mengklaim selesai');
  });

  it('memakai label netral untuk jenis yang belum dikenal', () => {
    expect(eventLabel('dari_masa_depan')).toBe('Pembaruan');
  });
});

describe('statusTone', () => {
  it('memetakan status ke nada visual yang berbeda', () => {
    expect(statusTone('verified_resolved')).toBe('verified');
    expect(statusTone('disputed')).toBe('alert');
    expect(statusTone('rejected')).toBe('alert');
    expect(statusTone('submitted')).toBe('progress');
    expect(statusTone('in_progress')).toBe('neutral');
  });
});

describe('aturan tindakan', () => {
  it('menolak dukungan pada laporan yang sudah ditutup, ditolak, atau draf', () => {
    expect(acceptsCorroboration('submitted')).toBe(true);
    expect(acceptsCorroboration('rejected')).toBe(false);
    expect(acceptsCorroboration('closed')).toBe(false);
    expect(acceptsCorroboration('draft')).toBe(false);
  });

  it('hanya meminta verifikasi warga pada status klaim selesai', () => {
    expect(needsCitizenClosure('claimed_resolved')).toBe(true);
    expect(needsCitizenClosure('verified_resolved')).toBe(false);
  });

  it('menandai status akhir', () => {
    expect(isTerminalStatus('verified_resolved')).toBe(true);
    expect(isTerminalStatus('rejected')).toBe(true);
    expect(isTerminalStatus('closed')).toBe(true);
    expect(isTerminalStatus('in_progress')).toBe(false);
  });
});

describe('warningText', () => {
  it('menerjemahkan peringatan yang dikirim server', () => {
    expect(warningText('photo_upload_ignored')).toContain('tanpa foto');
    expect(warningText('contact_email_ignored')).toContain('email');
  });

  it('mengabaikan kode tak dikenal', () => {
    expect(warningText('entah')).toBeNull();
  });
});

describe('public id', () => {
  it('menerima id 6 sampai 40 karakter alfanumerik', () => {
    expect(readPublicId('123456')).toBe('123456');
    expect(readPublicId(' ABC123 ')).toBe('ABC123');
    expect(readPublicId('a'.repeat(40))).toBe('a'.repeat(40));
  });

  it('menolak id pendek, terlalu panjang, atau berisi simbol', () => {
    expect(readPublicId('12345')).toBeNull();
    expect(readPublicId('a'.repeat(41))).toBeNull();
    expect(readPublicId('12-345')).toBeNull();
    expect(readPublicId('../../etc')).toBeNull();
    expect(readPublicId(null)).toBeNull();
  });
});

describe('laporan milik sendiri', () => {
  it('tidak melempar saat penyimpanan tidak tersedia', () => {
    expect(() => {
      rememberOwnReport('123456');
    }).not.toThrow();
    expect(isOwnReport('123456')).toBe(false);
  });

  it('mengabaikan id yang tidak valid', () => {
    expect(() => {
      rememberOwnReport('x');
    }).not.toThrow();
  });
});

describe('reportFormIssues', () => {
  const valid = { stopCode: 'BJM-014', category: 'service_wait' as const, text: 'a'.repeat(25) };

  it('reports nothing for a complete form', () => {
    expect(reportFormIssues(valid)).toEqual([]);
  });

  it('asks for a stop first', () => {
    const issues = reportFormIssues({ ...valid, stopCode: null });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.field).toBe(STOP_FIELD_ID);
    expect(issues[0]?.label).toBe('Halte');
  });

  it('asks for a category next', () => {
    const issues = reportFormIssues({ ...valid, category: null });
    expect(issues[0]?.field).toBe(CATEGORY_FIELD_ID);
  });

  it('reports the short text with the current length', () => {
    const issues = reportFormIssues({ ...valid, text: 'pendek' });
    expect(issues[0]?.field).toBe(TEXT_FIELD_ID);
    expect(issues[0]?.message).toContain(String(REPORT_MIN_TEXT));
    expect(issues[0]?.message).toContain('6');
  });

  it('lists every problem at once in reading order', () => {
    const issues = reportFormIssues({ stopCode: null, category: null, text: '' });
    expect(issues.map((issue) => issue.field)).toEqual([
      STOP_FIELD_ID,
      CATEGORY_FIELD_ID,
      TEXT_FIELD_ID,
    ]);
  });
});
