import type { TransparencyAnchor } from '@hadir/contracts';
import { useState } from 'react';
import {
  anchorDateLabel,
  formatAnchorCount,
  groupMerkleRoot,
  shortenRoot,
} from '../../lib/anchor';
import { safeExternalUrl } from '../../lib/safe-url';
import { formatDateTime } from '../../lib/time';

interface AnchorCardProps {
  anchor: TransparencyAnchor;
}

export function AnchorCard({ anchor }: AnchorCardProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const link = safeExternalUrl(anchor.verifyUrl);
  const chunks = groupMerkleRoot(anchor.merkleRoot);

  const copy = (): void => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setCopyFailed(true);
      return;
    }
    navigator.clipboard
      .writeText(anchor.merkleRoot)
      .then(() => {
        setCopyFailed(false);
        setCopied(true);
      })
      .catch(() => {
        setCopyFailed(true);
      });
  };

  return (
    <article className="anchor" aria-labelledby="anchor-title">
      <header className="anchor-head">
        <p className="label">Anchor harian</p>
        <h2 className="anchor-title" id="anchor-title">
          {anchorDateLabel(anchor.date)}
        </h2>
        <p className="anchor-meta">
          {formatAnchorCount(anchor.eventCount)} · diterbitkan {formatDateTime(anchor.publishedAt)}
        </p>
      </header>

      <div className="anchor-root">
        <p className="anchor-root-label">Akar Merkle</p>
        <code className="anchor-root-value" aria-label={`Akar Merkle ${shortenRoot(anchor.merkleRoot)}`}>
          {chunks.map((chunk, index) => (
            <span key={`${chunk}-${index}`}>{chunk}</span>
          ))}
        </code>
        <button type="button" className="link-button" onClick={copy}>
          {copied ? 'Tersalin' : 'Salin akar'}
        </button>
        {copyFailed ? (
          <p className="note">Papan klip tidak tersedia. Pilih teks akar di atas lalu salin manual.</p>
        ) : null}
      </div>

      <dl className="facts">
        <div>
          <dt>Rujukan luar</dt>
          <dd>{anchor.txRef === null ? 'Belum ada rujukan pihak ketiga' : anchor.txRef}</dd>
        </div>
        <div>
          <dt>Halaman verifikasi</dt>
          <dd>
            {link === null ? (
              'Tautan verifikasi tidak valid'
            ) : (
              <a href={link} rel="noreferrer noopener" target="_blank">
                Buka halaman verifikasi
              </a>
            )}
          </dd>
        </div>
      </dl>

      <p className="anchor-note">
        Akar ini dihitung dari rantai hash seluruh event laporan pada hari tersebut. Satu event yang
        diubah membuat akar yang dihitung ulang berbeda, sehingga perubahan bisa dibuktikan tanpa
        membuka isi laporan.
      </p>
    </article>
  );
}