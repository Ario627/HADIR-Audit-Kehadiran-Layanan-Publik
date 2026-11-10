import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { hashEmail, normalizeEmail } from '../common/auth/email-identity';
import { hashPassword, passwordWithinLimits } from '../common/auth/password';
import { env } from '../common/config/env';
import { contactCipherFromEnv } from '../common/crypto/contact-key';
import { seal } from '../common/crypto/secret-box';
import { closeDatabase, db } from '../db/client';

const logger = new Logger('PartnerDev');
const DEFAULT_EMAIL = 'mitra@hadir.local';
const DEFAULT_PASSWORD = 'hadir-dev-mitra';
const DEFAULT_NAME = 'Admin Dishub';
const DEFAULT_INSTITUTION = 'Dinhub Banyumas';

interface PartnerInput {
  email: string;
  password: string;
  displayName: string;
  institutionName: string;
  role: 'viewer' | 'responder' | 'admin';
}

function assertDevelopment(): void {
  if (env.NODE_ENV === 'production') {
    throw new Error('Perintah ini menolak berjalan saat NODE_ENV=production.');
  }
}

function readInput(): PartnerInput {
  const email = normalizeEmail(process.env.PARTNER_EMAIL?.trim() ?? DEFAULT_EMAIL);
  if (email === null) {
    throw new Error('PARTNER_EMAIL bukan alamat surel yang valid.');
  }
  const password = process.env.PARTNER_PASSWORD ?? DEFAULT_PASSWORD;
  if (!passwordWithinLimits(password)) {
    throw new Error('PARTNER_PASSWORD minimal 12 karakter.');
  }
  const role = process.env.PARTNER_ROLE;
  return {
    email,
    password,
    displayName: (process.env.PARTNER_NAME?.trim() ?? DEFAULT_NAME).slice(0, 120),
    institutionName: (process.env.PARTNER_INSTITUTION?.trim() ?? '').slice(0, 160),
    role: role === 'viewer' || role === 'responder' ? role : 'admin',
  };
}

async function institutionWithAuthority(): Promise<{ id: string; name: string } | null> {
  const result = await db.execute(sql`
    SELECT i.id, i.name
    FROM institutions i
    WHERE EXISTS (SELECT 1 FROM authority_map a WHERE a.institution_id = i.id)
    ORDER BY i.name
    LIMIT 1
  `);
  const row = result.rows[0] as { id: string; name: string } | undefined;
  return row ?? null;
}

async function institutionIdOf(requested: string): Promise<{ id: string; name: string }> {
  if (requested.length === 0) {
    const governed = await institutionWithAuthority();
    if (governed !== null) {
      logger.log(`Memakai instansi yang sudah punya kewenangan: ${governed.name}.`);
      return governed;
    }
    return institutionIdOf(DEFAULT_INSTITUTION);
  }
  const existing = await db.execute(sql`SELECT id, name FROM institutions WHERE name = ${requested} LIMIT 1`);
  const found = existing.rows[0] as { id: string; name: string } | undefined;
  if (found !== undefined) {
    return found;
  }
  const inserted = await db.execute(sql`
    INSERT INTO institutions (name) VALUES (${requested}) RETURNING id, name
  `);
  const created = inserted.rows[0] as { id: string; name: string } | undefined;
  if (created === undefined) {
    throw new Error('Gagal membuat instansi.');
  }
  logger.log(`Instansi baru dibuat: ${requested}.`);
  return created;
}

async function upsertUser(input: PartnerInput): Promise<string> {
  const cipherKey = contactCipherFromEnv();
  const emailHash = hashEmail(input.email, env.SESSION_SECRET);
  const emailEnc = seal(input.email, cipherKey.key);
  const existing = await db.execute(sql`
    SELECT id FROM partner_users WHERE email_hash = ${emailHash} LIMIT 1
  `);
  const found = existing.rows[0] as { id: string } | undefined;
  if (found === undefined) {
    const inserted = await db.execute(sql`
      INSERT INTO partner_users (email_hash, email_enc, display_name, status)
      VALUES (${emailHash}, ${emailEnc}, ${input.displayName}, 'active')
      RETURNING id
    `);
    const created = inserted.rows[0] as { id: string } | undefined;
    if (created === undefined) {
      throw new Error('Gagal membuat pengguna mitra.');
    }
    logger.log('Akun mitra baru dibuat.');
    return created.id;
  }
  await db.execute(sql`
    UPDATE partner_users
    SET display_name = ${input.displayName},
        status = 'active',
        failed_login_count = 0,
        locked_until = NULL,
        updated_at = now()
    WHERE id = ${found.id}
  `);
  logger.log('Akun mitra sudah ada; profil dan status aktif disegarkan.');
  return found.id;
}

async function upsertMembership(userId: string, institutionId: string, role: string): Promise<void> {
  const active = await db.execute(sql`
    SELECT id, role::text AS role FROM partner_memberships
    WHERE user_id = ${userId} AND institution_id = ${institutionId} AND revoked_at IS NULL
    LIMIT 1
  `);
  const found = active.rows[0] as { id: string; role: string } | undefined;
  if (found === undefined) {
    await db.execute(sql`
      INSERT INTO partner_memberships (user_id, institution_id, role)
      VALUES (${userId}, ${institutionId}, ${role}::partner_role)
    `);
    logger.log(`Keanggotaan dibuat dengan peran ${role}.`);
    return;
  }
  if (found.role !== role) {
    await db.execute(sql`
      UPDATE partner_memberships SET role = ${role}::partner_role WHERE id = ${found.id}
    `);
    logger.log(`Peran diperbarui menjadi ${role}.`);
  }
}

async function setPassword(userId: string, password: string): Promise<void> {
  const hash = await hashPassword(password);
  await db.execute(sql`
    INSERT INTO partner_password_credentials (user_id, password_hash, algorithm)
    VALUES (${userId}, ${hash}, 'argon2id')
    ON CONFLICT (user_id) DO UPDATE
    SET password_hash = EXCLUDED.password_hash,
        algorithm = EXCLUDED.algorithm,
        updated_at = now()
  `);
}

async function main(): Promise<void> {
  assertDevelopment();
  const input = readInput();
  const institution = await institutionIdOf(input.institutionName);
  const institutionId = institution.id;
  const userId = await upsertUser(input);
  await upsertMembership(userId, institutionId, input.role);
  await setPassword(userId, input.password);

  logger.log(`Mitra siap dipakai: ${input.email} (${input.role}) di ${institution.name}.`);
  logger.log(`Kata sandi: ${input.password}`);
  logger.log('Buka http://localhost:5173/masuk lalu masuk dengan metode kata sandi.');
  logger.log('Akun ini boleh mengundang anggota lain di http://localhost:5173/partner/anggota.');
}

main()
  .catch((error: unknown) => {
    logger.error('Penyiapan mitra gagal.', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
