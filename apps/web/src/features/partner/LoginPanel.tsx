import { useState } from 'react';
import { useElapsedSeconds } from '../../lib/use-elapsed-seconds';
import { describeError } from '../../lib/errors';
import { isApiError } from '../../lib/api';
import type { OtpIssue } from '../../lib/partner-guards';
import { usePartnerLogin, useRequestOtp } from './use-partner';

type Mode = 'otp' | 'password';

interface LoginPanelProps {
  onDone: () => void;
}

const EMAIL_MAX = 254;
const PASSWORD_MIN = 12;
const CODE_LENGTH = 6;
const GENERIC_LOGIN_FAILURE = 'Email dan kode tidak cocok. Periksa lagi, lalu coba ulang.';

function readEmail(value: string): string {
  return value.trim().toLowerCase().slice(0, EMAIL_MAX);
}

function readCode(value: string): string {
  return value.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function LoginPanel({ onDone }: LoginPanelProps) {
  const [mode, setMode] = useState<Mode>('otp');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<OtpIssue | null>(null);
  const otp = useRequestOtp();
  const login = usePartnerLogin();

  const elapsed = useElapsedSeconds(notice === null ? null : 0, notice !== null);
  const resendIn = notice === null ? 0 : Math.max(0, notice.resendInSeconds - elapsed);
  const normalized = readEmail(email);
  const emailLooksValid = normalized.includes('@') && normalized.length >= 5;

  const requestError = otp.isError ? describeError(otp.error) : null;
  const loginError = login.isError ? describeError(login.error) : null;
  const rateLimited =
    (isApiError(otp.error) && otp.error.code === 'RATE_LIMITED') ||
    (isApiError(login.error) && login.error.code === 'RATE_LIMITED');
  const retryAfter =
    (isApiError(otp.error) ? otp.error.retryAfterSeconds : null) ??
    (isApiError(login.error) ? login.error.retryAfterSeconds : null);

  const sendCode = (): void => {
    if (!emailLooksValid || resendIn > 0) {
      return;
    }
    otp.mutate(normalized, {
      onSuccess: (issue) => {
        setNotice(issue);
        setCode('');
      },
    });
  };

  const submitOtp = (): void => {
    if (!emailLooksValid || code.length !== CODE_LENGTH) {
      return;
    }
    login.mutate({ method: 'otp', email: normalized, code }, { onSuccess: onDone });
  };

  const submitPassword = (): void => {
    if (!emailLooksValid || password.length < PASSWORD_MIN) {
      return;
    }
    login.mutate({ method: 'password', email: normalized, password }, { onSuccess: onDone });
  };

  return (
    <section className="login" aria-labelledby="login-title">
      <h2 className="login-title" id="login-title">
        Masuk dengan akun instansi
      </h2>
      <p className="login-lede">
        Akun mitra dibuat lewat undangan instansi. HADIR tidak membuka pendaftaran sendiri, jadi tidak
        ada formulir daftar di halaman ini.
      </p>

      <div className="login-modes" role="group" aria-label="Cara masuk">
        <button
          type="button"
          className="btn btn--ghost"
          aria-pressed={mode === 'otp'}
          onClick={() => {
            setMode('otp');
          }}
        >
          Kode lewat email
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-pressed={mode === 'password'}
          onClick={() => {
            setMode('password');
          }}
        >
          Kata sandi
        </button>
      </div>

      <form
        className="login-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (mode === 'otp') {
            if (notice === null) {
              sendCode();
              return;
            }
            submitOtp();
            return;
          }
          submitPassword();
        }}
      >
        <div className="field">
          <label htmlFor="login-email">Email instansi</label>
          <input
            id="login-email"
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            maxLength={EMAIL_MAX}
            required
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </div>

        {mode === 'otp' ? (
          <>
            {notice === null ? null : (
              <div className="field">
                <label htmlFor="login-code">Kode {CODE_LENGTH} angka</label>
                <input
                  id="login-code"
                  type="text"
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={CODE_LENGTH}
                  required
                  value={code}
                  aria-describedby="login-code-hint"
                  onChange={(event) => {
                    setCode(readCode(event.target.value));
                  }}
                />
                <p className="field-hint" id="login-code-hint">
                  Kode berlaku {Math.round(notice.expiresInSeconds / 60)} menit. Kalau email itu
                  terdaftar, kode sudah dikirim; kami tidak memberi tahu apakah email terdaftar.
                </p>
              </div>
            )}
            <div className="actions">
              {notice === null ? (
                <button type="submit" className="btn" disabled={!emailLooksValid || otp.isPending}>
                  {otp.isPending ? 'Mengirim kode' : 'Kirim kode'}
                </button>
              ) : (
                <>
                  <button
                    type="submit"
                    className="btn"
                    disabled={code.length !== CODE_LENGTH || login.isPending}
                  >
                    {login.isPending ? 'Memeriksa' : 'Masuk'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={resendIn > 0 || otp.isPending}
                    onClick={sendCode}
                  >
                    {resendIn > 0 ? `Kirim ulang dalam ${resendIn} dtk` : 'Kirim ulang kode'}
                  </button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="login-password">Kata sandi</label>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                minLength={PASSWORD_MIN}
                maxLength={256}
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
              <p className="field-hint">
                Minimal {PASSWORD_MIN} karakter. Kalau kamu belum pernah menyetel kata sandi, masuk
                dengan kode email.
              </p>
            </div>
            <div className="actions">
              <button
                type="submit"
                className="btn"
                disabled={!emailLooksValid || password.length < PASSWORD_MIN || login.isPending}
              >
                {login.isPending ? 'Memeriksa' : 'Masuk'}
              </button>
            </div>
          </>
        )}
      </form>

      {rateLimited ? (
        <div className="alert-box" role="alert">
          <p>
            Terlalu banyak percobaan
            {retryAfter === null ? '' : ` dari perangkat ini. Coba lagi dalam ${retryAfter} detik.`}
            {retryAfter === null ? '. Tunggu sebentar lalu coba lagi.' : ''}
          </p>
        </div>
      ) : null}

      {loginError === null ? null : (
        <div className="alert-box" role="alert">
          <p>
            {isApiError(login.error) && login.error.code === 'UNAUTHENTICATED'
              ? GENERIC_LOGIN_FAILURE
              : loginError.detail}
          </p>
        </div>
      )}

      {requestError === null || rateLimited ? null : (
        <p className="note" role="status">
          {requestError.detail}
        </p>
      )}
    </section>
  );
}