import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { StatePanel } from '../components/StatePanel';
import { AnchorCard } from '../features/transparency/AnchorCard';
import {
  ANCHOR_SCAN_DAYS,
  anchorDayCount,
  previousDays,
  readAnchorDate,
  yesterdayUtc,
} from '../lib/anchor';
import { isApiError } from '../lib/api';
import { describeError } from '../lib/errors';
import { methodologyQuery, transparencyAnchorQuery } from '../lib/queries';
import { formatDate } from '../lib/time';
import {
  TRANSPARENCY_SECTIONS,
  changelogOf,
  correctionPolicy,
  versionAgeText,
} from '../lib/transparency';

function TransparencyIndexPage() {
  const queryClient = useQueryClient();
  const today = yesterdayUtc(new Date());
  const [date, setDate] = useState(today);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const anchor = useQuery(transparencyAnchorQuery(date));
  const methodology = useQuery(methodologyQuery());
  const now = Date.now();
  const changelog = methodology.data === undefined ? [] : changelogOf(methodology.data);

  const findLatest = async (): Promise<void> => {
    setScanning(true);
    setScanNote(null);
    const days = previousDays(today, ANCHOR_SCAN_DAYS);
    for (const day of days) {
      try {
        const found = await queryClient.fetchQuery(transparencyAnchorQuery(day));
        setDate(found.date);
        setScanning(false);
        return;
      } catch (error) {
        if (isApiError(error) && error.code === 'NOT_FOUND') {
          continue;
        }
        setScanNote(describeError(error).detail);
        setScanning(false);
        return;
      }
    }
    setScanNote(`Tidak ada anchor yang diterbitkan dalam ${anchorDayCount(ANCHOR_SCAN_DAYS)} terakhir.`);
    setScanning(false);
  };

  const notFound = anchor.isError && isApiError(anchor.error) && anchor.error.code === 'NOT_FOUND';
  const otherError = anchor.isError && !notFound;

  return (
    <>
      <div className="page-head">
        <p className="label">Transparansi</p>
        <h1 className="page-title">Anchor harian rantai laporan</h1>
        <p className="page-lede">
          Setiap hari HADIR meringkas rantai hash laporan menjadi satu akar Merkle. Akar itu bisa kamu
          bandingkan sendiri dengan arsip event yang tersimpan.
        </p>
      </div>

      <form
        className="anchor-form"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <div className="field">
          <label htmlFor="anchor-date">Tanggal anchor</label>
          <input
            id="anchor-date"
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              const next = readAnchorDate(event.target.value);
              setScanNote(null);
              if (next !== null) {
                setDate(next);
              }
            }}
          />
          <p className="field-hint">
            Hanya hari yang sudah berakhir bisa punya anchor. Tanggal kosong berarti anchor belum
            diterbitkan, bukan hilang.
          </p>
        </div>
        <div className="actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              void findLatest();
            }}
            disabled={scanning}
            aria-busy={scanning}
          >
            {scanning ? 'Mencari' : 'Cari anchor terakhir'}
          </button>
        </div>
      </form>

      {scanNote === null ? null : <p className="note">{scanNote}</p>}

      {anchor.isPending ? (
        <StatePanel title="Memuat anchor">Mengambil akar Merkle untuk tanggal ini.</StatePanel>
      ) : notFound ? (
        <StatePanel title="Anchor belum diterbitkan">
          Belum ada anchor untuk tanggal ini. Pilih tanggal lain atau cari anchor terakhir yang sudah
          diterbitkan.
        </StatePanel>
      ) : otherError ? (
        <>
          <StatePanel tone="error" title={describeError(anchor.error).title}>
            {describeError(anchor.error).detail}
          </StatePanel>
          <div className="actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                void anchor.refetch();
              }}
            >
              Coba lagi
            </button>
          </div>
        </>
      ) : anchor.data === undefined ? (
        <StatePanel tone="error" title="Anchor tidak bisa ditampilkan">
          Data anchor tidak lolos pemeriksaan bentuk, jadi tidak ditampilkan.
        </StatePanel>
      ) : (
        <>
          <AnchorCard anchor={anchor.data} />
          <p className="note">
            Tautan tetap untuk tanggal ini:{' '}
            <Link to="/transparansi/$date" params={{ date: anchor.data.date }}>
              /transparansi/{anchor.data.date}
            </Link>
          </p>
        </>
      )}

      <section className="transparency" aria-labelledby="changelog-title">
        <h2 className="section-title" id="changelog-title">
          Changelog metode
        </h2>
        {methodology.isError ? (
          <p className="note">
            Versi metode tidak bisa dimuat sekarang. Halaman ini tidak menampilkan versi yang belum
            terverifikasi.
          </p>
        ) : changelog.length === 0 ? (
          <p className="note">Memuat versi metode.</p>
        ) : (
          <ul className="changelog-list">
            {changelog.map((entry) => (
              <li key={entry.version} className="changelog-item">
                <p className="changelog-version">Versi {entry.version}</p>
                <p className="changelog-meta">
                  {formatDate(entry.updatedAt)} · {versionAgeText(entry.updatedAt, now)}
                </p>
                <p className="changelog-summary">{entry.summary}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="note">
          Riwayat versi sebelumnya tidak disimpan oleh API publik, jadi hanya versi yang sedang berlaku
          yang bisa ditampilkan di sini. Rincian tiap versi ada di{' '}
          <Link to="/metodologi">halaman metodologi</Link>.
        </p>
      </section>

      <section className="transparency" aria-labelledby="correction-title">
        <h2 className="section-title" id="correction-title">
          Log koreksi
        </h2>
        <p className="prose">{correctionPolicy()}</p>
        {TRANSPARENCY_SECTIONS.map((section) =>
          section.id === 'koreksi' ? (
            <p key={section.id} className="note">
              {section.body}
            </p>
          ) : null,
        )}
      </section>

      {TRANSPARENCY_SECTIONS.filter((section) => section.id !== 'koreksi').map((section) => (
        <section key={section.id} className="transparency" aria-labelledby={`${section.id}-title`}>
          <h2 className="section-title" id={`${section.id}-title`}>
            {section.title}
          </h2>
          <p className="prose">{section.body}</p>
        </section>
      ))}
    </>
  );
}

export const Route = createFileRoute('/transparansi/')({
  component: TransparencyIndexPage,
});