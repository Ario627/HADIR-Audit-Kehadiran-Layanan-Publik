import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { isApiError } from '../../lib/api';
import { describeError } from '../../lib/errors';
import { describedByFor, hasIssueFor, issueFor, type FieldIssue } from '../../lib/form-errors';
import {
  PASSWORD_MAX,
  PASSWORD_MIN,
  collectPasswordIssues,
  hasPasswordIssue,
  readPasswordIssues,
} from '../../lib/partner';
import { changePartnerPassword } from '../../lib/partner-api';
import { ErrorSummary } from '../forms/ErrorSummary';

export function PasswordChange() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [issues, setIssues] = useState<readonly FieldIssue[]>([]);
  const [submitCount, setSubmitCount] = useState(0);
  const [changed, setChanged] = useState<number | null>(null);
  const local = readPasswordIssues({ current, next, confirm });

  const mutate = useMutation({
    mutationFn: () => changePartnerPassword(current, next),
    retry: 0,
    onSuccess: (result) => {
      setChanged(result.revokedSessions);
      setCurrent('');
      setNext('');
      setConfirm('');
      setIssues([]);
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
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setChanged(null);
          const found = collectPasswordIssues(local);
          setIssues(found);
          setSubmitCount((current) => current + 1);
          if (hasPasswordIssue(local)) {
            return;
          }
          mutate.mutate();
        }}
      >
        <ErrorSummary issues={issues} focusSignal={submitCount} />

        <div className="field">
          <label htmlFor="password-current">Kata sandi sekarang</label>
          <input
            id="password-current"
            type="password"
            autoComplete="current-password"
            maxLength={PASSWORD_MAX}
            value={current}
            aria-invalid={hasIssueFor(issues, 'password-current')}
            aria-describedby={describedByFor('password-current', hasIssueFor(issues, 'password-current'))}
            onChange={(event) => {
              setCurrent(event.target.value);
            }}
          />
          {issueFor(issues, 'password-current') === null ? null : (
            <p className="field-error" id="password-current-galat">
              {issueFor(issues, 'password-current')}
            </p>
          )}
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
            aria-invalid={hasIssueFor(issues, 'password-next')}
            aria-describedby={describedByFor('password-next', hasIssueFor(issues, 'password-next'))}
            onChange={(event) => {
              setNext(event.target.value);
            }}
          />
          {issueFor(issues, 'password-next') === null ? null : (
            <p className="field-error" id="password-next-galat">
              {issueFor(issues, 'password-next')}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="password-confirm">Ulangi kata sandi baru</label>
          <input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            maxLength={PASSWORD_MAX}
            value={confirm}
            aria-invalid={hasIssueFor(issues, 'password-confirm')}
            aria-describedby={describedByFor('password-confirm', hasIssueFor(issues, 'password-confirm'))}
            onChange={(event) => {
              setConfirm(event.target.value);
            }}
          />
          {issueFor(issues, 'password-confirm') === null ? null : (
            <p className="field-error" id="password-confirm-galat">
              {issueFor(issues, 'password-confirm')}
            </p>
          )}
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