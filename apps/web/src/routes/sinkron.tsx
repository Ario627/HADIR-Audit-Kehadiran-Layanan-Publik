import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useState } from 'react';
import {
  OUTBOX_EVENT,
  isDue,
  shouldAbandon,
  summarize,
  type OutboxEntry,
} from '../lib/outbox';
import { readOutbox } from '../lib/outbox-store';
import { categoryLabel } from '../lib/report';
import { formatDateTime } from '../lib/time';

const KIND_LABEL: Readonly<Record<string, string>> = {
  'episode.end': 'Selesai menunggu',
  'report.create': 'Laporan warga',
};

const ERROR_TEXT: Readonly<Record<string, string>> = {
  network_error: 'jaringan tidak tersedia',
  timeout: 'koneksi habis waktu',
  rate_limited: 'terlalu sering dikirim',
  server_error: 'server sedang bermasalah',
  validation_failed: 'isi catatan ditolak server',
  unknown: 'sebab belum diketahui',
};

function entryTitle(entry: OutboxEntry): string {
  if (entry.kind === 'report.create') {
    return `${KIND_LABEL['report.create']} · ${entry.body.stopCode}`;
  }
  return `${KIND_LABEL['episode.end']} · ${entry.body.outcome}`;
}

function entryDetail(entry: OutboxEntry): string | null {
  return entry.kind === 'report.create' ? categoryLabel(entry.body.category) : null;
}

function entryState(entry: OutboxEntry, now: number): { tone: string; label: string } {
  if (shouldAbandon(entry, now)) {
    return { tone: 'alert', label: 'berhenti dicoba' };
  }
  if (isDue(entry, now)) {
    return { tone: 'pending', label: 'siap dikirim' };
  }
  return { tone: 'none', label: 'menunggu jadwal' };
}

function SyncPage() {
  const [entries, setEntries] = useState<OutboxEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async (): Promise<void> => {
    setEntries(await readOutbox());
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(OUTBOX_EVENT, () => {
      void refresh();
    });
    window.addEventListener('online', () => {
      void refresh();
    });
    return () => {
      window.removeEventListener(OUTBOX_EVENT, refresh);
      window.removeEventListener('online', refresh);
    };
  }, [refresh]);

  const flush = (): void => {
    setBusy(true);
    setNotice(null);
    void import('../lib/outbox-sync')
      .then((module) => module.flushOutbox())
      .then(async (result) => {
        await refresh();
        const parts: string[] = [];
        if (result.sent > 0) {
          parts.push(`${String(result.sent)} terkirim`);
        }
        if (result.retried > 0) {
          parts.push(`${String(result.retried)} dicoba ulang`);
        }
        if (result.dropped > 0) {
          parts.push(`${String(result.dropped)} dibuang karena kedaluwarsa`);
        }
        setNotice(parts.length === 0 ? 'Belum ada catatan yang siap dikirim sekarang.' : `${parts.join(' · ')}.`);
      })
      .catch(() => {
        setNotice('Pengiriman gagal dimulai. Catatan tetap tersimpan di perangkat ini.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const summary = entries === null ? null : summarize(entries, now);

  return (
    <>
      <div className="page-head">
        <p className="label">Sinkronisasi</p>
        <h1 className="page-title">Catatan yang belum terkirim</h1>
        <p className="page-lede">
          Catatan disimpan di perangkat ini dulu, lalu dikirim ulang otomatis. Tidak ada catatan
          yang hilang saat sinyal putus.
        </p>
      </div>

      {entries === null ? (
        <p className="note">Memuat antrean.</p>
      ) : entries.length === 0 ? (
        <p className="note">Antrean kosong. Semua catatan sudah sampai ke server.</p>
      ) : (
        <>
          {summary === null ? null : (
            <p className="chips">
              <span className="chip chip--none">{String(summary.total)} tersimpan</span>
              <span className="chip chip--pending">{String(summary.due)} siap dikirim</span>
              {summary.stalled === 0 ? null : (
                <span className="chip chip--alert">{String(summary.stalled)} berhenti</span>
              )}
            </p>
          )}

          <ol className="sync-list">
            {entries.map((entry) => {
              const state = entryState(entry, now);
              const detail = entryDetail(entry);
              return (
                <li key={entry.id} className="sync-item">
                  <div className="sync-item-head">
                    <span className="sync-item-title">{entryTitle(entry)}</span>
                    <span className={`chip chip--${state.tone}`}>{state.label}</span>
                  </div>
                  <p className="sync-item-meta">
                    <span>dibuat {formatDateTime(new Date(entry.createdAt).toISOString())}</span>
                    <span>{String(entry.attempts)} percobaan</span>
                    {detail === null ? null : <span>{detail}</span>}
                  </p>
                  {entry.lastErrorCode === null ? null : (
                    <p className="sync-item-error">
                      Percobaan terakhir gagal: {ERROR_TEXT[entry.lastErrorCode] ?? entry.lastErrorCode}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="actions">
        <button type="button" className="btn" onClick={flush} disabled={busy || entries === null}>
          {busy ? 'Mengirim…' : 'Kirim sekarang'}
        </button>
      </div>

      {notice === null ? null : (
        <p className="note" role="status">
          {notice}
        </p>
      )}

      <p className="note">
        Catatan yang gagal delapan kali atau lebih tua dari 48 jam akan berhenti dicoba supaya
        antrean tidak menumpuk.
      </p>
    </>
  );
}

export const Route = createFileRoute('/sinkron')({
  component: SyncPage,
});
