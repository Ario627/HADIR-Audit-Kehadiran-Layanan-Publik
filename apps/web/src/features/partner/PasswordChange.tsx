import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  hasPasswordIssue,
  readPasswordIssues,
} from '../../lib/partner';
import { changePartnerPassword } from '../../lib/partner-api';

export function PasswordChange() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [changed, setChanged] = useState<number | null>(null);
  const issues = readPasswordIssues({ current, next, confirm });

  const mutate = useMutation({
    mutationFn: () => changePartnerPassword(current, next),
    retry: 0,
    onSuccess: (result) => {
      setChanged(result.revokedSessions);
      setCurrent('');
      setNext('');
      setConfirm('');
      setAttempted(false);
    },
  });

  const errorMessage = mutate.isError ? describeError(mutate.error) : null;
  const staleSession = isApiError(mutate.error) && mutate.error.code === 'FORBIDDEN';

  return (
    <section className="settings-block" aria-labelledby="password-title">
      <h2 className="section-title" id="password-title">
        Kata sandi
      </h2>
      <p className="settings-meta">
        Minimal {PASSWORD_MIN} karakter. Setelah kata sandi berubah, sesi lain milik akun ini diputus.
      </p>

      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          setChanged(null);
          if (hasPasswordIssue(issues)) {
            return;
          }
          mutate.mutate();
        }}
      >
        <div className="field">
          <label htmlFor="password-current">Kata sandi sekarang</label>
          <input
            id="password-current"
            type="password"
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            value={current}
            aria-invalid={attempted && issues.current !== null}
            aria-describedby={
              attempted && issues.current !== null ? 'password-current-error' : undefined
            }
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
          {attempted && issues.current !== null ? (
            <p className="field-error" id="password-current-error" role="alert">
              {issues.current}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="password-next">Kata sandi baru</label>
          <input
            id="password-next"
            type="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            value={next}
            aria-invalid={attempted && issues.next !== null}
            aria-describedby={attempted && issues.next !== null ? 'password-next-error' : undefined}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          {attempted && issues.next !== null ? (
            <p className="field-error" id="password-next-error" role="alert">
              {issues.next}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="password-confirm">Ulangi kata sandi baru</label>
          <input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={confirm}
            aria-invalid={attempted && issues.confirm !== null}
            aria-describedby={
              attempted && issues.confirm !== null ? 'password-confirm-error' : undefined
            }
            onChange={(event) => {
              setConfirm(event.target.value);
            }}
          />
          {attempted && issues.confirm !== null ? (
            <p className="field-error" id="password-confirm-error" role="alert">
              {issues.confirm}
            </p>
          ) : null}
        </div>

        {errorMessage === null ? null : (
          <div className="alert-box" role="alert">
            <p>{errorMessage.detail}</p>
            {staleSession ? (
              <p>
                <Link to="/masuk" search={{ next: '/partner/pengaturan' }}>
                  Masuk ulang lalu ulangi perubahan
                </Link>
              </p>
            ) : null}
          </div>
        )}

        {changed === null ? null : (
          <p className="note" role="status">
            Kata sandi berubah.{' '}
            {changed === 0
              ? 'Tidak ada sesi lain yang perlu diputus.'
              : `${changed} sesi lain sudah diputus.`}
          </p>
        )}

        <div className="actions">
          <button type="submit" className="btn" disabled={mutate.isPending}>
            {mutate.isPending ? 'Menyimpan' : 'Simpan kata sandi'}
          </button>
        </div>
      </form>

      <p className="note">
        Halaman ini tidak menyimpan kata sandi di peramban dan tidak mencatatnya ke log. Kalau kamu lupa
        kata sandi sekarang, minta admin instansi mengirim ulang undangan.
      </p>
    </section>
  );
}