import { AppError } from '../../common/errors/app-error';
import { contactCipherFromEnv, contactEmailHash, type ContactCipher } from '../../common/crypto/contact-key';
import { seal } from '../../common/crypto/secret-box';
import { normalizeEmail } from '../../common/auth/email-identity';

export interface ContactEnvelope {
  enc: Buffer;
  hash: Buffer;
}

export function contactCipher(): ContactCipher {
  return contactCipherFromEnv();
}

export function encodeContactEmail(raw: string | null | undefined, cipher: ContactCipher): ContactEnvelope | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  const normalized = normalizeEmail(raw);
  if (normalized === null) {
    throw new AppError('VALIDATION_FAILED', {
      detail: 'Email tidak valid.',
      errors: [
        {
          field: 'contactEmail',
          code: 'invalid_email',
          message: 'Tulis alamat email yang valid atau kosongkan.',
        },
      ],
    });
  }
  return {
    enc: seal(normalized, cipher.key),
    hash: contactEmailHash(normalized, cipher.pepper),
  };
}
