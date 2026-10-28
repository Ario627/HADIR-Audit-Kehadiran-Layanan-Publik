import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type PasskeyFailure =
  | { kind: 'unsupported' }
  | { kind: 'cancelled' }
  | { kind: 'already_registered' }
  | { kind: 'needs_user_verification' }
  | { kind: 'domain_mismatch' }
  | { kind: 'no_algorithm' }
  | { kind: 'failed' };

export type PasskeyResult = { kind: 'ok'; response: RegistrationResponseJSON } | PasskeyFailure;

const CODE_BY_FAILURE: Record<PasskeyFailure['kind'], readonly string[]> = {
  unsupported: [],
  cancelled: ['ERROR_CEREMONY_ABORTED'],
  already_registered: ['ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'],
  needs_user_verification: [
    'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT',
    'ERROR_AUTO_REGISTER_USER_VERIFICATION_FAILURE',
  ],
  domain_mismatch: ['ERROR_INVALID_DOMAIN', 'ERROR_INVALID_RP_ID'],
  no_algorithm: ['ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'],
  failed: [],
};

const FAILURE_TEXT: Record<PasskeyFailure['kind'], string> = {
  unsupported:
    'Peramban atau perangkat ini belum bisa membuat passkey. Kamu tetap bisa masuk dengan kode email atau kata sandi.',
  cancelled: 'Pembuatan passkey dibatalkan. Tidak ada yang berubah di akunmu.',
  already_registered:
    'Perangkat ini sudah terdaftar sebagai passkey untuk akunmu. Tidak perlu mendaftar dua kali.',
  needs_user_verification:
    'Perangkat ini tidak punya verifikasi pengguna (PIN, sidik jari, atau wajah). Passkey HADIR mewajibkannya, jadi perangkat ini tidak bisa dipakai.',
  domain_mismatch:
    'Domain aplikasi tidak cocok dengan pengaturan passkey di server. Ini kesalahan konfigurasi, bukan kesalahanmu.',
  no_algorithm:
    'Perangkat tidak mendukung algoritma kunci yang diminta server. Coba perangkat atau peramban lain.',
  failed: 'Passkey gagal dibuat. Tidak ada yang berubah di akunmu.',
};

const MESSAGE_MAX = 300;

function failureCodeOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length <= 64 ? code : null;
}

function failureNameOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : null;
}

export function classifyCeremonyError(error: unknown): PasskeyFailure {
  const code = failureCodeOf(error);
  if (code !== null) {
    for (const [kind, codes] of Object.entries(CODE_BY_FAILURE)) {
      if ((codes as readonly string[]).includes(code)) {
        return { kind: kind as PasskeyFailure['kind'] };
      }
    }
    return { kind: 'failed' };
  }
  const name = failureNameOf(error);
  if (name === 'NotAllowedError' || name === 'AbortError') {
    return { kind: 'cancelled' };
  }
  if (name === 'SecurityError') {
    return { kind: 'domain_mismatch' };
  }
  if (name === 'NotSupportedError') {
    return { kind: 'unsupported' };
  }
  return { kind: 'failed' };
}

export function passkeyFailureText(failure: PasskeyFailure): string {
  return FAILURE_TEXT[failure.kind];
}

function isCreationOptions(value: Record<string, unknown>): boolean {
  const rp = value.rp;
  const user = value.user;
  const params = value.pubKeyCredParams;
  if (typeof value.challenge !== 'string' || value.challenge.length === 0) {
    return false;
  }
  if (typeof rp !== 'object' || rp === null || typeof user !== 'object' || user === null) {
    return false;
  }
  return Array.isArray(params) && params.length > 0;
}

export async function passkeyAvailable(): Promise<boolean> {
  try {
    const mod = await import('@simplewebauthn/browser');
    return await mod.browserSupportsPasskeys();
  } catch {
    return false;
  }
}

export async function enrolPasskey(options: Record<string, unknown>): Promise<PasskeyResult> {
  if (!isCreationOptions(options)) {
    return { kind: 'failed' };
  }
  let mod: typeof import('@simplewebauthn/browser');
  try {
    mod = await import('@simplewebauthn/browser');
  } catch {
    return { kind: 'unsupported' };
  }
  try {
    const supported = await mod.browserSupportsPasskeys();
    if (!supported) {
      return { kind: 'unsupported' };
    }
  } catch {
    return { kind: 'unsupported' };
  }
  try {
    const response = await mod.startRegistration({
      optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
    });
    return { kind: 'ok', response };
  } catch (error) {
    return classifyCeremonyError(error);
  }
}

export function describePasskeyError(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'Passkey gagal dibuat.';
  }
  const message = (error as { message?: unknown }).message;
  if (typeof message !== 'string' || message.length === 0) {
    return 'Passkey gagal dibuat.';
  }
  return message.slice(0, MESSAGE_MAX);
}