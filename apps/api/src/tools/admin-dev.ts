import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { normalizeEmail } from '../common/auth/email-identity';
import { hashPassword, passwordWithinLimits } from '../common/auth/password';
import { generateTotpSecret, otpauthUri, totpAt } from '../common/auth/totp';
import { env } from '../common/config/env';
import { contactCipherFromEnv } from '../common/crypto/contact-key';
import { seal } from '../common/crypto/secret-box';
import { closeDatabase, db } from '../db/client';
import { platformAdmins } from '../db/schema';

const logger = new Logger('AdminDev');
const DEFAULT_EMAIL = 'admin@hadir.local';
const DEFAULT_PASSWORD = 'hadir-dev-admin';
const DEFAULT_NAME = 'Operator HADIR';
const TOTP_STEP_MS = 30_000;

interface DevAdminInput {
  email: string;
  displayName: string;
  password: string;
  role: 'moderator' | 'superadmin';
}

function assertDevelopment(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Perintah ini menolak berjalan saat NODE_ENV=production.');
  }
}

function readInput(): DevAdminInput {
  const rawEmail = process.env.ADMIN_EMAIL?.trim() ?? DEFAULT_EMAIL;
  const email = normalizeEmail(rawEmail);
  if (email === null) {
    throw new Error('ADMIN_EMAIL bukan alamat email yang valid.');
  }
  const password = process.env.ADMIN_PASSWORD ?? DEFAULT_PASSWORD;
  if (!passwordWithinLimits(password)) {
    throw new Error('ADMIN_PASSWORD minimal 12 karakter.');
  }
  return {
    email,
    displayName: (process.env.ADMIN_NAME?.trim() ?? DEFAULT_NAME).slice(0, 120),
    password,
    role: process.env.ADMIN_ROLE === 'moderator' ? 'moderator' : 'superadmin',
  };
}

async function findAdminId(email: string): Promise<string | null> {
  const rows = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function createCredentials(
  input: DevAdminInput,
): Promise<{ secret: Buffer; base32: string }> {
  const { secret, base32 } = generateTotpSecret();
  const passwordHash = await hashPassword(input.password);
  const totpSecretEnc = seal(secret.toString('base64'), contactCipherFromEnv().key);

  await db.insert(platformAdmins).values({
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    passwordHash: Buffer.from(passwordHash, 'utf8'),
    totpSecretEnc,
    totpEnrolledAt: new Date(),
    lastTotpStep: null,
    disabledAt: null,
  });

  return { secret, base32 };
}

async function resetCredentials(
  input: DevAdminInput,
  adminId: string,
): Promise<{ secret: Buffer; base32: string }> {
  const { secret, base32 } = generateTotpSecret();
  const passwordHash = await hashPassword(input.password);
  const totpSecretEnc = seal(secret.toString('base64'), contactCipherFromEnv().key);

  await db
    .update(platformAdmins)
    .set({
      displayName: input.displayName,
      role: input.role,
      passwordHash: Buffer.from(passwordHash, 'utf8'),
      totpSecretEnc,
      totpEnrolledAt: new Date(),
      lastTotpStep: null,
      disabledAt: null,
      updatedAt: new Date(),
    })
    .where(eq(platformAdmins.id, adminId));

  return { secret, base32 };
}

function secondsLeft(atMs: number): number {
  return Math.ceil((TOTP_STEP_MS - (atMs % TOTP_STEP_MS)) / 1000);
}

function printCredentials(input: DevAdminInput, secret: Buffer, base32: string): void {
  const now = Date.now();
  logger.log(`Admin siap dipakai: ${input.email} (${input.role}).`);
  logger.log(`Kata sandi: ${input.password}`);
  logger.log(`Secret TOTP base32: ${base32}`);
  logger.log(
    `otpauth: ${otpauthUri({ secretBase32: base32, accountName: input.email, issuer: 'HADIR' })}`,
  );
  logger.log(`Buka http://localhost:5173/admin/masuk lalu isi email, kata sandi, dan kode TOTP.`);
  logger.log(`Kode TOTP saat ini: ${totpAt(secret, now)} (berlaku ${secondsLeft(now)} detik).`);
  logger.log('Kode berikutnya bisa dicetak ulang dengan: pnpm --filter @hadir/api admin:code');
}

async function main(): Promise<void> {
  assertDevelopment();
  const input = readInput();
  const adminId = await findAdminId(input.email);
  const issued =
    adminId === null ? await createCredentials(input) : await resetCredentials(input, adminId);

  if (adminId === null) {
    logger.log('Akun admin baru dibuat.');
  } else {
    logger.log('Akun admin sudah ada; kata sandi dan secret TOTP direset.');
  }
  printCredentials(input, issued.secret, issued.base32);
}

main()
  .catch((error: unknown) => {
    logger.error('Penyiapan admin gagal.', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
