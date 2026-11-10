import type { AnchorInclusionProof, AnchorPublicKey } from '@hadir/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { apiGetChecked, isApiError, type PayloadSchema } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { isRecord, readCount, readIsoDateTime, readText } from '../../lib/guards';
import { readPublicId } from '../../lib/report';
import { formatDate } from '../../lib/time';

function readProof(value: unknown): AnchorInclusionProof | null {
  if (!isRecord(value)) {
    return null;
  }
  const date = readText(value.date, 10);
  const reportPublicId = readText(value.reportPublicId, 40);
  const leaf = readText(value.leaf, 128);
  const root = readText(value.root, 128);
  const seq = readCount(value.seq, 1_000_000);
  const index = readCount(value.index, 1_000_000);
  const verified = typeof value.verified === 'boolean' ? value.verified : null;
  if (
    date === null ||
    reportPublicId === null ||
    leaf === null ||
    root === null ||
    seq === null ||
    index === null ||
    verified === null ||
    !Array.isArray(value.proof)
  ) {
    return null;
  }
  const proof: string[] = [];
  for (const step of value.proof) {
    const text = readText(step, 128);
    if (text === null) {
      return null;
    }
    proof.push(text);
  }
  return { date, reportPublicId, seq, leaf, index, proof, root, verified };
}

const proofSchema: PayloadSchema<AnchorInclusionProof> = {
  safeParse(value: unknown) {
    const proof = readProof(value);
    return proof === null
      ? ({ success: false } as const)
      : ({ success: true, data: proof } as const);
  },
};

const keysSchema: PayloadSchema<AnchorPublicKey[]> = {
  safeParse(value: unknown) {
    if (!isRecord(value) || !Array.isArray(value.items) || value.items.length > 20) {
      return { success: false as const };
    }
    const items: AnchorPublicKey[] = [];
    for (const entry of value.items) {
      if (!isRecord(entry)) {
        return { success: false as const };
      }
      const keyId = readText(entry.keyId, 64);
      const publicKey = readText(entry.publicKey, 64);
      const anchorCount = readCount(entry.anchorCount, 1_000_000);
      if (entry.algorithm !== 'ed25519' || keyId === null || publicKey === null || anchorCount === null) {
        return { success: false as const };
      }
      items.push({
        algorithm: 'ed25519',
        keyId,
        publicKey,
        firstAnchoredAt: readIsoDateTime(entry.firstAnchoredAt),
        lastAnchoredAt: readIsoDateTime(entry.lastAnchoredAt),
        anchorCount,
      });
    }
    return { success: true as const, data: items };
  },
};

export async function fetchAnchorKeys(): Promise<AnchorPublicKey[]> {
  const envelope = await apiGetChecked('/v1/transparency/keys', keysSchema);
  return envelope.data;
}

export async function fetchInclusionProof(publicId: string): Promise<AnchorInclusionProof> {
  const envelope = await apiGetChecked(
    `/v1/transparency/proof/${encodeURIComponent(publicId)}`,
    proofSchema,
  );
  return envelope.data;
}

export function AnchorKeys({ keys }: { keys: readonly AnchorPublicKey[] }) {
  if (keys.length === 0) {
    return (
      <p className="dossier-sub dossier-sub--quiet">
        Belum ada kunci penanda tangan yang dipakai. Anchor pertama akan mendaftarkan kuncinya.
      </p>
    );
  }

  return (
    <div className="keys">
      {keys.map((key) => (
        <div key={key.keyId} className="key-row">
          <p className="key-id">{key.keyId}</p>
          <p className="key-fingerprint">{key.publicKey.slice(0, 24)}</p>
          <p className="key-meta">
            {key.anchorCount === 0 ? 'belum dipakai' : `${String(key.anchorCount)} anchor`}
            {key.lastAnchoredAt === null ? '' : ` · terakhir ${formatDate(key.lastAnchoredAt)}`}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ProofChecker() {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const proof = useMutation({
    mutationFn: async (publicId: string) => fetchInclusionProof(publicId),
    onSuccess: () => {
      setProblem(null);
    },
    onError: (error: unknown) => {
      setProblem(
        isApiError(error) ? describeError(error).detail : 'Bukti tidak bisa diambil sekarang.',
      );
    },
  });

  const submit = (): void => {
    const publicId = readPublicId(value);
    if (publicId === null) {
      setProblem('Nomor laporan tidak sesuai format, contoh LPR-2026-000123.');
      return;
    }
    proof.mutate(publicId);
  };

  return (
    <section className="proof" aria-labelledby="proof-title">
      <h2 className="section-title" id="proof-title">
        Bukti keikutsertaan
      </h2>
      <p className="dossier-sub">
        Setiap perubahan status laporan masuk ke pohon Merkle harian. Masukkan nomor laporan untuk
        melihat jalur buktinya terhadap akar yang sudah dipublikasikan.
      </p>

      <form
        className="proof-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor="proof-public-id">Nomor laporan</label>
          <input
            id="proof-public-id"
            name="publicId"
            type="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            value={value}
            placeholder="LPR-2026-000123"
            aria-invalid={problem !== null}
            onChange={(event) => {
              setValue(event.target.value.slice(0, 40));
            }}
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn" disabled={proof.isPending}>
            {proof.isPending ? 'Memeriksa…' : 'Periksa bukti'}
          </button>
        </div>
      </form>

      {problem === null ? null : (
        <p className="field-error" role="alert">
          {problem}
        </p>
      )}

      {proof.data === undefined ? null : (
        <div className={`proof-result proof-result--${proof.data.verified ? 'verified' : 'alert'}`}>
          <p className="proof-status">
            {proof.data.verified
              ? 'Jalur bukti cocok dengan akar harian.'
              : 'Jalur bukti tidak cocok dengan akar harian.'}
          </p>
          <dl className="proof-facts">
            <div>
              <dt>Tanggal anchor</dt>
              <dd>{formatDate(proof.data.date)}</dd>
            </div>
            <div>
              <dt>Urutan event</dt>
              <dd>{String(proof.data.seq)}</dd>
            </div>
            <div>
              <dt>Posisi daun</dt>
              <dd>{String(proof.data.index)}</dd>
            </div>
            <div>
              <dt>Panjang jalur</dt>
              <dd>{String(proof.data.proof.length)} langkah</dd>
            </div>
          </dl>
          <p className="proof-hash">
            <span className="proof-hash-label">daun</span>
            {proof.data.leaf}
          </p>
          <p className="proof-hash">
            <span className="proof-hash-label">akar</span>
            {proof.data.root}
          </p>
        </div>
      )}
    </section>
  );
}
