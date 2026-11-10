import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { AppealGrounds, AppealView } from '@hadir/contracts';
import { describeError } from '../../lib/errors';
import { fetchAppeals, submitAppeal } from '../../lib/governance-api';
import { uuidv7 } from '../../lib/id';
import { reportQueryKey } from '../../lib/report-api';

const GROUNDS: ReadonlyArray<{ value: AppealGrounds; label: string; hint: string }> = [
  {
    value: 'rejection',
    label: 'Penolakan laporan',
    hint: 'Laporan memenuhi syarat, tetapi ditolak.',
  },
  {
    value: 'resolution',
    label: 'Hasil penyelesaian',
    hint: 'Masalah masih terjadi setelah diklaim selesai.',
  },
  {
    value: 'moderation',
    label: 'Moderasi konten',
    hint: 'Konten tidak melanggar pedoman.',
  },
  {
    value: 'service',
    label: 'Tidak ada tindak lanjut',
    hint: 'Tenggat tindak lanjut terlewat tanpa penjelasan.',
  },
];

const MIN_STATEMENT = 20;

export function appealQueryKey(publicId: string) {
  return ['appeals', publicId] as const;
}

export function useAppeals(publicId: string) {
  return useQuery({
    queryKey: appealQueryKey(publicId),
    queryFn: () => fetchAppeals(publicId),
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}

export function useSubmitAppeal(publicId: string) {
  const queryClient = useQueryClient();
  const attempt = useRef<{ signature: string; key: string } | null>(null);

  return useMutation({
    mutationFn: async (input: {
      grounds: AppealGrounds;
      statement: string;
      evidenceUrls: string[];
    }) => {
      const signature = `${input.grounds}|${input.statement}|${input.evidenceUrls.join(',')}`;
      if (attempt.current === null || attempt.current.signature !== signature) {
        attempt.current = { signature, key: uuidv7() };
      }
      return submitAppeal(
        publicId,
        input.grounds,
        input.statement,
        input.evidenceUrls,
        attempt.current.key,
      );
    },
    onSuccess: async () => {
      attempt.current = null;
      await queryClient.invalidateQueries({ queryKey: appealQueryKey(publicId) });
      await queryClient.invalidateQueries({ queryKey: reportQueryKey(publicId) });
    },
  });
}

function AppealRow({ appeal }: { appeal: AppealView }) {
  return (
    <li className="appeal">
      <p className="appeal__head">
        <span className="appeal__grounds">{appeal.groundsLabel}</span>
        <span className="appeal__status">{appeal.summary}</span>
      </p>
      <p className="appeal__statement">{appeal.statement}</p>
      {appeal.decisionNote === null ? null : (
        <p className="appeal__decision">Keputusan: {appeal.decisionNote}</p>
      )}
      {appeal.evidenceUrls.length === 0 ? null : (
        <ul className="appeal__evidence">
          {appeal.evidenceUrls.map((url) => (
            <li key={url}>
              <a href={url} rel="noreferrer noopener" target="_blank">
                Bukti
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export interface AppealSectionProps {
  publicId: string;
}

export function AppealSection({ publicId }: AppealSectionProps) {
  const appeals = useAppeals(publicId);
  const submit = useSubmitAppeal(publicId);
  const [grounds, setGrounds] = useState<AppealGrounds>('resolution');
  const [statement, setStatement] = useState('');
  const [evidence, setEvidence] = useState('');
  const [open, setOpen] = useState(false);

  const items = appeals.data ?? [];
  const failure = submit.isError ? describeError(submit.error) : null;
  const blocked = appeals.isError ? describeError(appeals.error) : null;
  const tooShort = statement.trim().length < MIN_STATEMENT;

  return (
    <section className="appeals" aria-labelledby="appeals-heading">
      <h2 className="label" id="appeals-heading">
        Banding
      </h2>

      {blocked === null ? null : (
        <p className="note">Banding hanya tampil untuk perangkat yang membuat laporan ini.</p>
      )}

      {items.length === 0 ? (
        <p className="note">Belum ada banding untuk laporan ini.</p>
      ) : (
        <ul className="appeal-list">
          {items.map((appeal) => (
            <AppealRow key={appeal.id} appeal={appeal} />
          ))}
        </ul>
      )}

      {open ? (
        <form
          className="appeal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (tooShort) {
              return;
            }
            const urls = evidence
              .split(/\s+/u)
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
              .slice(0, 5);
            submit.mutate({ grounds, statement: statement.trim(), evidenceUrls: urls });
          }}
        >
          <label className="label" htmlFor="appeal-grounds">
            Alasan banding
          </label>
          <select
            id="appeal-grounds"
            className="input"
            value={grounds}
            onChange={(event) => {
              setGrounds(event.target.value as AppealGrounds);
            }}
          >
            {GROUNDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="note">{GROUNDS.find((option) => option.value === grounds)?.hint}</p>

          <label className="label" htmlFor="appeal-statement">
            Keterangan
          </label>
          <textarea
            id="appeal-statement"
            className="input"
            rows={4}
            maxLength={2000}
            value={statement}
            onChange={(event) => {
              setStatement(event.target.value);
            }}
          />
          <p className="note">
            {tooShort
              ? `Minimal ${String(MIN_STATEMENT)} karakter.`
              : `${String(statement.trim().length)} karakter.`}
          </p>

          <label className="label" htmlFor="appeal-evidence">
            Tautan bukti (opsional, maksimal 5)
          </label>
          <input
            id="appeal-evidence"
            className="input"
            type="text"
            value={evidence}
            onChange={(event) => {
              setEvidence(event.target.value);
            }}
          />

          {failure === null ? null : (
            <p className="note note--error">
              {failure.title}: {failure.detail}
            </p>
          )}

          <div className="actions">
            <button type="submit" className="btn" disabled={tooShort || submit.isPending}>
              {submit.isPending ? 'Mengirim' : 'Kirim banding'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setOpen(false);
              }}
            >
              Batal
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setOpen(true);
          }}
        >
          Ajukan banding
        </button>
      )}

      <p className="note">
        Banding tidak menghapus riwayat. Keputusan awal, alasan banding, dan hasilnya tetap
        tercatat. Maksimal dua banding per laporan.
      </p>
    </section>
  );
}
