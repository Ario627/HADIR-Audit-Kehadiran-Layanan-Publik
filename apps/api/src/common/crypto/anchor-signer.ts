import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import {
  ANCHOR_ALGORITHM,
  ANCHOR_PUBLIC_KEY_BYTES,
  canonicalAnchorPayload,
  type AnchorEnvelope,
} from '@hadir/domain';
import { AppError } from '../errors/app-error';

const PEM_PREFIX = '-----BEGIN';

export interface AnchorSigner {
  keyId: string;
  publicKeyBase64: string;
  sign(payload: string): Buffer;
}

export interface SignedAnchorParts {
  signatureBase64: string;
  signatureAlgorithm: string;
  signingKeyId: string;
  publicKeyBase64: string;
}

function parsePrivateKey(raw: string): KeyObject {
  const trimmed = raw.trim();
  if (trimmed.startsWith(PEM_PREFIX)) {
    return createPrivateKey({ key: trimmed, format: 'pem' });
  }
  return createPrivateKey({
    key: Buffer.from(trimmed, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });
}

function assertEd25519(key: KeyObject, label: string): void {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${label} bukan kunci Ed25519 (ditemukan ${key.asymmetricKeyType ?? 'unknown'}).`);
  }
}

export function createAnchorSigner(input: {
  privateKey: string;
  keyId: string;
}): AnchorSigner {
  const keyId = input.keyId.trim();
  if (keyId.length === 0 || keyId.length > 64) {
    throw new Error('ANCHOR_SIGNING_KEY_ID harus 1..64 karakter.');
  }
  const privateKey = parsePrivateKey(input.privateKey);
  assertEd25519(privateKey, 'Kunci privat anchor');
  const publicKey = createPublicKey(privateKey);
  const publicKeyRaw = publicKey.export({ format: 'der', type: 'spki' });
  const raw = Buffer.from(publicKeyRaw);
  const keyBytes = raw.subarray(raw.length - ANCHOR_PUBLIC_KEY_BYTES);
  if (keyBytes.length !== ANCHOR_PUBLIC_KEY_BYTES) {
    throw new Error('Kunci publik anchor tidak 32 byte.');
  }
  return {
    keyId,
    publicKeyBase64: keyBytes.toString('base64'),
    sign(payload: string): Buffer {
      return cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey);
    },
  };
}

export function anchorSignedParts(
  signer: AnchorSigner,
  envelope: AnchorEnvelope,
  signedAt: Date,
): SignedAnchorParts & { canonicalPayload: string; signedAt: Date } {
  const canonicalPayload = canonicalAnchorPayload(envelope);
  const signature = signer.sign(canonicalPayload);
  return {
    canonicalPayload,
    signatureBase64: signature.toString('base64'),
    signatureAlgorithm: ANCHOR_ALGORITHM,
    signingKeyId: signer.keyId,
    publicKeyBase64: signer.publicKeyBase64,
    signedAt,
  };
}

export function verifyAnchorSignature(input: {
  envelope: AnchorEnvelope;
  publicKeyBase64: string;
  signatureBase64: string;
}): boolean {
  try {
    const raw = Buffer.from(input.publicKeyBase64, 'base64');
    if (raw.length !== ANCHOR_PUBLIC_KEY_BYTES) {
      return false;
    }
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
    const publicKey = createPublicKey({
      key: Buffer.concat([spkiPrefix, raw]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(
      null,
      Buffer.from(canonicalAnchorPayload(input.envelope), 'utf8'),
      publicKey,
      Buffer.from(input.signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}

export function generateAnchorKeyPair(): {
  privateKeyPem: string;
  publicKeyBase64: string;
} {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
  const spki = Buffer.from(pair.publicKey.export({ format: 'der', type: 'spki' }));
  return {
    privateKeyPem,
    publicKeyBase64: spki.subarray(spki.length - ANCHOR_PUBLIC_KEY_BYTES).toString('base64'),
  };
}

export function requireAnchorSigner(
  privateKey: string | null,
  keyId: string | null,
): AnchorSigner {
  if (privateKey === null || keyId === null) {
    throw new AppError('SERVICE_UNAVAILABLE', {
      detail: 'Penandatanganan anchor belum dikonfigurasi.',
    });
  }
  try {
    return createAnchorSigner({ privateKey, keyId });
  } catch (error) {
    throw new AppError('SERVICE_UNAVAILABLE', {
      detail: `Kunci anchor tidak dapat dipakai: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}
