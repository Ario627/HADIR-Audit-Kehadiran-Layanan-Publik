import {
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import {
  ATTESTATION_ALGORITHM,
  ATTESTATION_PUBLIC_KEY_BYTES,
  canonicalResponsePayload,
  type ResponseAttestationInput,
} from '@hadir/domain';

const PEM_PREFIX = '-----BEGIN';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface ResponseSigner {
  keyId: string;
  publicKeyBase64: string;
  sign(payload: string): Buffer;
}

export interface SignedResponseParts {
  bodyDigest: Buffer;
  signature: Buffer;
  signatureAlgorithm: string;
  signingKeyId: string;
  publicKey: Buffer;
  signedAt: Date;
  canonicalPayload: string;
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
    throw new Error(
      `${label} bukan kunci Ed25519 (ditemukan ${key.asymmetricKeyType ?? 'unknown'}).`,
    );
  }
}

export function createResponseSigner(input: {
  privateKey: string;
  keyId: string;
}): ResponseSigner {
  const keyId = input.keyId.trim();
  if (keyId.length === 0 || keyId.length > 64) {
    throw new Error('RESPONSE_SIGNING_KEY_ID harus 1..64 karakter.');
  }
  const privateKey = parsePrivateKey(input.privateKey);
  assertEd25519(privateKey, 'Kunci privat tanggapan');
  const publicKey = createPublicKey(privateKey);
  const spki = Buffer.from(publicKey.export({ format: 'der', type: 'spki' }));
  const keyBytes = spki.subarray(spki.length - ATTESTATION_PUBLIC_KEY_BYTES);
  if (keyBytes.length !== ATTESTATION_PUBLIC_KEY_BYTES) {
    throw new Error('Kunci publik tanggapan tidak 32 byte.');
  }
  return {
    keyId,
    publicKeyBase64: keyBytes.toString('base64'),
    sign(payload: string): Buffer {
      return cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey);
    },
  };
}

export function signedResponseParts(
  signer: ResponseSigner,
  input: ResponseAttestationInput,
  bodyDigest: Buffer,
  signedAt: Date,
): SignedResponseParts {
  const canonicalPayload = canonicalResponsePayload(input);
  return {
    bodyDigest,
    signature: signer.sign(canonicalPayload),
    signatureAlgorithm: ATTESTATION_ALGORITHM,
    signingKeyId: signer.keyId,
    publicKey: Buffer.from(signer.publicKeyBase64, 'base64'),
    signedAt,
    canonicalPayload,
  };
}

export function verifyResponseSignature(input: {
  payload: string;
  publicKeyBase64: string;
  signatureBase64: string;
}): boolean {
  try {
    const raw = Buffer.from(input.publicKeyBase64, 'base64');
    if (raw.length !== ATTESTATION_PUBLIC_KEY_BYTES) {
      return false;
    }
    const publicKey = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, raw]),
      format: 'der',
      type: 'spki',
    });
    return cryptoVerify(
      null,
      Buffer.from(input.payload, 'utf8'),
      publicKey,
      Buffer.from(input.signatureBase64, 'base64'),
    );
  } catch {
    return false;
  }
}
