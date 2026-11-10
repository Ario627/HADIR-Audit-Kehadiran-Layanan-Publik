import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../common/auth/email-identity';
import { base32Encode, totpAt } from '../common/auth/totp';
import { env } from '../common/config/env';
import { contactCipherFromEnv } from '../common/crypto/contact-key';
import { open } from '../common/crypto/secret-box';
import { closeDatabase, db } from '../db/client';
import { platformAdmins } from '../db/schema';

const logger = new Logger('AdminCode');
const DEFAULT_EMAIL = 'admin@hadir.local';
const TOTP_STEP_MS = 30_000;

function assertDevelopment(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Perintah ini menolak berjalan saat NODE_ENV=production.');
  }
}

function readEmail(): string {
  const fromArg = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--email='))
    ?.slice('--email='.length);
  const email = normalizeEmail(process.env.ADMIN_EMAIL?.trim() ?? fromArg ?? DEFAULT_EMAIL);
  if (email === null) {
    throw new Error('Email admin tidak valid. Pakai --email=alamat@contoh.id.');
  }
  return email;
}

async function secretOf(email: string): Promise<{ secret: Buffer; disabled: boolean } | null> {
  const rows = await db
    .select({
      totpSecretEnc: platformAdmins.totpSecretEnc,
      disabledAt: platformAdmins.disabledAt,
    })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email))
    .limit(1);

  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const plaintext = open(row.totpSecretEnc, contactCipherFromEnv().key);
  return { secret: Buffer.from(plaintext, 'base64'), disabled: row.disabledAt !== null };
}

function secondsLeft(atMs: number): number {
  return Math.ceil((TOTP_STEP_MS - (atMs % TOTP_STEP_MS)) / 1000);
}

async function main(): Promise<void> {
  assertDevelopment();
  const email = readEmail();
  const found = await secretOf(email);

  if (found === null) {
    logger.error(`Admin ${email} belum ada. Jalankan dulu: pnpm --filter @hadir/api admin:dev`);
    process.exitCode = 1;
    return;
  }

  if (found.disabled) {
    logger.warn(`Admin ${email} sedang dinonaktifkan. Login akan ditolak.`);
  }

  const now = Date.now();
  logger.log(`Email: ${email}`);
  logger.log(`Secret base32: ${base32Encode(found.secret)}`);
  logger.log(`Kode TOTP sekarang: ${totpAt(found.secret, now)} (berlaku ${secondsLeft(now)} detik)`);
}

main()
  .catch((error: unknown) => {
    logger.error('Gagal membaca kode TOTP.', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
