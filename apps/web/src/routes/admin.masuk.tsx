import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useAdminLogin } from '../features/admin/use-admin';
import { describeError } from '../lib/errors';

const MIN_PASSWORD = 12;

function AdminLoginPage() {
  const navigate = useNavigate();
  const login = useAdminLogin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const failure = login.isError ? describeError(login.error) : null;

  const submit = (): void => {
    login.mutate(
      { email: email.trim(), password, totp: totp.trim() },
      {
        onSuccess: () => {
          void navigate({ to: '/admin', replace: true });
        },
      },
    );
  };

  return (
    <>
      <div className="page-head">
        <p className="label">Konsol platform</p>
        <h1 className="page-title">Masuk sebagai admin</h1>
        <p className="page-lede">
          Halaman ini untuk moderator dan superadmin platform. Akun mitra instansi memakai pintu
          masuk yang berbeda di halaman mitra.
        </p>
      </div>

      <form
        className="console-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="field">
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            type="email"
            name="email"
            autoComplete="username"
            required
            maxLength={254}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="admin-password">Kata sandi</label>
          <input
            id="admin-password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            minLength={MIN_PASSWORD}
            maxLength={256}
            value={password}
            aria-describedby="admin-password-hint"
            onChange={(event) => {
              setPassword(event.target.value);
            }}
          />
          <p className="field-hint" id="admin-password-hint">
            Minimal {MIN_PASSWORD} karakter. Server menolak kata sandi yang lebih pendek.
          </p>
        </div>

        <div className="field">
          <label htmlFor="admin-totp">Kode TOTP</label>
          <input
            id="admin-totp"
            type="text"
            name="otp"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            value={totp}
            aria-describedby="admin-totp-hint"
            onChange={(event) => {
              setTotp(event.target.value.replace(/[^0-9]/gu, '').slice(0, 6));
            }}
          />
          <p className="field-hint" id="admin-totp-hint">
            Enam angka dari aplikasi autentikator. Tanpa kode ini sesi tidak diterbitkan.
          </p>
        </div>

        {failure === null ? null : (
          <p className="field-error" role="alert">
            {failure.title}. {failure.detail}
          </p>
        )}

        <div className="actions">
          <button
            type="submit"
            className="btn"
            disabled={login.isPending || email.trim().length === 0 || totp.length !== 6}
          >
            {login.isPending ? 'Memeriksa…' : 'Masuk'}
          </button>
        </div>
      </form>
    </>
  );
}

export const Route = createFileRoute('/admin/masuk')({
  component: AdminLoginPage,
});
