import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from './client';
import { hashPassword, passwordWithinLimits } from '../common/auth/password';
import { generateTotpSecret, otpauthUri } from '../common/auth/totp';
import { contactCipherFromEnv } from '../common/crypto/contact-key';
import { seal } from '../common/crypto/secret-box';
import { normalizeEmail } from '../common/auth/email-identity';
import { platformAdmins } from './schema';

interface BootstrapInput {
  email: string;
  displayName: string;
  password: string;
  role: 'moderator' | 'superadmin';
}

const logger = new Logger('BootstrapAdmin');

function readInput(): BootstrapInput {
  const email = process.env.ADMIN_EMAIL?.trim() ?? '';
  const displayName = process.env.ADMIN_NAME?.trim() ?? 'Operator HADIR';
  const password = process.env.ADMIN_PASSWORD ?? '';
  const role = process.env.ADMIN_ROLE === 'moderator' ? 'moderator' : 'superadmin';

  if (email.length === 0) {
    throw new Error('ADMIN_EMAIL wajib diisi.');
  }
  const normalized = normalizeEmail(email);
  if (normalized === null) {
    throw new Error('ADMIN_EMAIL bukan alamat email yang valid.');
  }
  if (!passwordWithinLimits(password)) {
    throw new Error('ADMIN_PASSWORD minimal 12 karakter.');
  }
  return {
    email: normalized,
    displayName: displayName.slice(0, 120),
    password,
    role,
  };
}

async function existing(email: string): Promise<boolean> {
  const rows = await db
    .select({ id: platformAdmins.id })
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email))
    .limit(1);
  return rows.length > 0;
}

async function main(): Promise<void> {
  const input = readInput();

  if (await existing(input.email)) {
    logger.log(`Admin ${input.email} sudah ada; tidak ada perubahan.`);
    return;
  }

  const { secret, base32 } = generateTotpSecret();
  const passwordHash = await hashPassword(input.password);
  const sealed = seal(secret.toString('base64'), contactCipherFromEnv().key);

  await db.insert(platformAdmins).values({
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    passwordHash: Buffer.from(passwordHash, 'utf8'),
    totpSecretEnc: sealed,
  });

  logger.log(`Admin ${input.email} dibuat dengan role ${input.role}.`);
  logger.log('Simpan secret TOTP berikut sekarang; tidak akan ditampilkan lagi.');
  logger.log(`TOTP base32: ${base32}`);
  logger.log(
    `otpauth: ${otpauthUri({ secretBase32: base32, accountName: input.email, issuer: 'HADIR' })}`,
  );
}

main()
  .catch((error: unknown) => {
    logger.error(
      'Bootstrap admin gagal.',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
