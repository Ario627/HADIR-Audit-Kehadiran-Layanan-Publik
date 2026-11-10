import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConsoleEmpty,
  ConsoleFailure,
  ConsoleHint,
  ConsolePanel,
} from '../features/admin/console-ui';
import { useAdminProfile } from '../features/admin/use-admin';
import { fetchFlags, setFlag } from '../lib/admin-api';
import { describeError } from '../lib/errors';
import { formatDateTime } from '../lib/time';

function AdminFlagPage() {
  const queryClient = useQueryClient();
  const profile = useAdminProfile();
  const superadmin = profile.data?.role === 'superadmin';
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  const flags = useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: () => fetchFlags(),
    staleTime: 30_000,
    retry: false,
  });

  const save = useMutation({
    mutationFn: (input: { key: string; parsed: unknown }) =>
      setFlag(input.key, {
        value: input.parsed,
        ...(description.trim().length === 0 ? {} : { description: description.trim() }),
      }),
    retry: 0,
    onSuccess: (saved) => {
      setNotice(`Flag ${saved.key} disimpan.`);
      setEditing(null);
      setValue('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['admin', 'flags'] });
    },
  });

  const failure = save.isError ? describeError(save.error) : null;

  const submit = (key: string): void => {
    try {
      const parsed: unknown = JSON.parse(value);
      setParseError(null);
      save.mutate({ key, parsed });
    } catch {
      setParseError('Nilai harus JSON yang sah, misalnya true, 10, atau {"mode":"uji"}.');
    }
  };

  return (
    <>
      <div className="page-head">
        <p className="label">Flag</p>
        <h1 className="page-title">Saklar fitur</h1>
        <p className="page-lede">
          Flag dibaca saat permintaan berjalan, bukan saat build. Mengubahnya tidak perlu deploy,
          tetapi tetap tercatat di log audit.
        </p>
      </div>

      <ConsolePanel
        title="Flag terdaftar"
        meta={flags.data === undefined ? 'memuat' : `${String(flags.data.length)} kunci`}
      >
        {flags.isPending ? (
          <ConsoleHint>Memuat flag.</ConsoleHint>
        ) : flags.isError ? (
          <ConsoleFailure
            title={describeError(flags.error).title}
            detail={describeError(flags.error).detail}
            onRetry={() => {
              void flags.refetch();
            }}
          />
        ) : flags.data.length === 0 ? (
          <ConsoleEmpty>Belum ada flag tersimpan.</ConsoleEmpty>
        ) : (
          <ul className="queue">
            {flags.data.map((flag) => (
              <li key={flag.key} className="queue-row queue-row--stacked">
                <div className="queue-main">
                  <span className="queue-title">{flag.key}</span>
                  <span className="queue-text">
                    {flag.description ?? 'tanpa keterangan'}
                  </span>
                </div>
                <p className="queue-meta">
                  <span className="queue-code">{JSON.stringify(flag.value)}</span>
                  <span>diubah {formatDateTime(flag.updatedAt)}</span>
                </p>

                {superadmin ? (
                  editing === flag.key ? (
                    <div className="console-inline">
                      <div className="field">
                        <label htmlFor={`flag-value-${flag.key}`}>Nilai JSON</label>
                        <input
                          id={`flag-value-${flag.key}`}
                          type="text"
                          value={value}
                          onChange={(event) => {
                            setValue(event.target.value);
                            setParseError(null);
                          }}
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`flag-desc-${flag.key}`}>Keterangan perubahan</label>
                        <input
                          id={`flag-desc-${flag.key}`}
                          type="text"
                          maxLength={240}
                          value={description}
                          onChange={(event) => {
                            setDescription(event.target.value);
                          }}
                        />
                      </div>
                      {parseError === null ? null : (
                        <p className="field-error" role="alert">
                          {parseError}
                        </p>
                      )}
                      <div className="actions">
                        <button
                          type="button"
                          className="btn"
                          disabled={save.isPending || value.trim().length === 0}
                          onClick={() => {
                            submit(flag.key);
                          }}
                        >
                          {save.isPending ? 'Menyimpan…' : 'Simpan nilai'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            setEditing(null);
                            setParseError(null);
                          }}
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setEditing(flag.key);
                          setValue(JSON.stringify(flag.value));
                          setDescription('');
                          setNotice(null);
                        }}
                      >
                        Ubah nilai
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {failure === null ? null : (
          <p className="field-error" role="alert">
            {failure.title}. {failure.detail}
          </p>
        )}

        {notice === null ? null : (
          <p className="console-notice" role="status">
            {notice}
          </p>
        )}

        {superadmin ? null : (
          <ConsoleHint>Hanya superadmin yang bisa mengubah nilai flag.</ConsoleHint>
        )}
      </ConsolePanel>
    </>
  );
}

export const Route = createFileRoute('/admin/flag')({
  component: AdminFlagPage,
});
