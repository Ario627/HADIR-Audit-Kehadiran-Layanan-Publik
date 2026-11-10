export const ATTESTATION_SCHEMA_VERSION = 1;
export const ATTESTATION_ALGORITHM = 'ed25519';
export const ATTESTATION_SIGNATURE_BYTES = 64;
export const ATTESTATION_PUBLIC_KEY_BYTES = 32;
export const ATTESTATION_KEY_ID_MAX = 64;
export const ATTESTATION_DOMAIN = 'hadir.response.v1';

export type AttestationStatus =
  | 'unsigned'
  | 'verified'
  | 'signature_mismatch'
  | 'unsupported_algorithm'
  | 'payload_mismatch'
  | 'structural_invalid';

export interface ResponseAttestationInput {
  reportPublicId: string;
  institutionId: string;
  kind: string;
  bodyDigestHex: string;
  evidenceUrls: readonly string[];
  publishedAt: string;
  correctsResponseId: string | null;
}

export interface AttestationEnvelope {
  reportPublicId: string;
  institutionId: string;
  kind: string;
  bodyDigestHex: string;
  evidenceUrls: readonly string[];
  publishedAt: string;
  correctsResponseId: string | null;
  signatureBase64: string | null;
  signatureAlgorithm: string | null;
  signingKeyId: string | null;
  publicKeyBase64: string | null;
  signedAt: string | null;
}

export interface AttestationCheck {
  id: string;
  status: AttestationStatus;
  detail: string;
}

export interface AttestationVerification {
  status: AttestationStatus;
  checks: readonly AttestationCheck[];
  signed: boolean;
  message: string;
}

const HEX_PATTERN = /^[a-f0-9]{64}$/u;

function canonicalUrl(url: string): string {
  return url.trim();
}

export function isBodyDigestHex(value: string): boolean {
  return HEX_PATTERN.test(value);
}

export function canonicalResponsePayload(input: ResponseAttestationInput): string {
  const urls = input.evidenceUrls.map(canonicalUrl).filter((url) => url.length > 0);
  return [
    ATTESTATION_DOMAIN,
    `v=${String(ATTESTATION_SCHEMA_VERSION)}`,
    `report=${input.reportPublicId}`,
    `institution=${input.institutionId}`,
    `kind=${input.kind}`,
    `bodyDigest=${input.bodyDigestHex.toLowerCase()}`,
    `evidence=${urls.length === 0 ? '-' : urls.join(',')}`,
    `publishedAt=${input.publishedAt}`,
    `corrects=${input.correctsResponseId ?? '-'}`,
  ].join('\n');
}

export function attestationPayloadFrom(
  envelope: Pick<
    AttestationEnvelope,
    | 'reportPublicId'
    | 'institutionId'
    | 'kind'
    | 'bodyDigestHex'
    | 'evidenceUrls'
    | 'publishedAt'
    | 'correctsResponseId'
  >,
): string {
  return canonicalResponsePayload({
    reportPublicId: envelope.reportPublicId,
    institutionId: envelope.institutionId,
    kind: envelope.kind,
    bodyDigestHex: envelope.bodyDigestHex,
    evidenceUrls: envelope.evidenceUrls,
    publishedAt: envelope.publishedAt,
    correctsResponseId: envelope.correctsResponseId,
  });
}

export function attestationIsSigned(envelope: AttestationEnvelope): boolean {
  return (
    envelope.signatureBase64 !== null &&
    envelope.signatureAlgorithm !== null &&
    envelope.signingKeyId !== null &&
    envelope.publicKeyBase64 !== null
  );
}

export function attestationByteLength(base64: string | null): number | null {
  if (base64 === null) {
    return null;
  }
  const trimmed = base64.trim();
  if (trimmed.length === 0 || !/^[A-Za-z0-9+/=_-]+$/u.test(trimmed)) {
    return null;
  }
  const normalised = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalised.endsWith('==') ? 2 : normalised.endsWith('=') ? 1 : 0;
  return Math.floor((normalised.length * 3) / 4) - padding;
}

export function structuralAttestationError(
  envelope: AttestationEnvelope,
): string | null {
  if (!isBodyDigestHex(envelope.bodyDigestHex)) {
    return 'Digest isi tanggapan bukan sha256 heksadesimal 64 karakter.';
  }
  if (envelope.publishedAt.trim().length === 0) {
    return 'Waktu terbit tanggapan kosong.';
  }
  if (Number.isNaN(Date.parse(envelope.publishedAt))) {
    return 'Waktu terbit tanggapan bukan tanggal yang sah.';
  }
  if (!attestationIsSigned(envelope)) {
    return null;
  }
  if (envelope.signatureAlgorithm !== ATTESTATION_ALGORITHM) {
    return `Algoritma tanda tangan ${String(envelope.signatureAlgorithm)} tidak didukung.`;
  }
  if (attestationByteLength(envelope.signatureBase64) !== ATTESTATION_SIGNATURE_BYTES) {
    return 'Panjang tanda tangan bukan 64 byte.';
  }
  if (attestationByteLength(envelope.publicKeyBase64) !== ATTESTATION_PUBLIC_KEY_BYTES) {
    return 'Panjang kunci publik bukan 32 byte.';
  }
  if (
    envelope.signingKeyId === null ||
    envelope.signingKeyId.trim().length === 0 ||
    envelope.signingKeyId.length > ATTESTATION_KEY_ID_MAX
  ) {
    return 'ID kunci penanda tangan tidak sah.';
  }
  return null;
}

export function verifyResponseAttestation(
  envelope: AttestationEnvelope,
  verifySignature: (payload: string, signatureBase64: string, publicKeyBase64: string) => boolean,
): AttestationVerification {
  const structural = structuralAttestationError(envelope);
  if (structural !== null) {
    const status: AttestationStatus = attestationIsSigned(envelope)
      ? 'structural_invalid'
      : 'unsigned';
    return {
      status,
      signed: attestationIsSigned(envelope),
      checks: [{ id: 'structure', status, detail: structural }],
      message: structural,
    };
  }

  if (!attestationIsSigned(envelope)) {
    return {
      status: 'unsigned',
      signed: false,
      checks: [
        {
          id: 'structure',
          status: 'unsigned',
          detail: 'Tanggapan ini diterbitkan tanpa tanda tangan kriptografis.',
        },
      ],
      message:
        'Tanggapan tidak ditandatangani. Integritas urutan tetap dijaga rantai peristiwa, tetapi isi tidak dapat dibuktikan berasal dari institusi itu sendiri.',
    };
  }

  const payload = attestationPayloadFrom(envelope);
  const matches = verifySignature(
    payload,
    envelope.signatureBase64 as string,
    envelope.publicKeyBase64 as string,
  );
  const status: AttestationStatus = matches ? 'verified' : 'signature_mismatch';
  return {
    status,
    signed: true,
    checks: [
      {
        id: 'structure',
        status: 'verified',
        detail: 'Bentuk tanda tangan sesuai.',
      },
      {
        id: 'signature',
        status,
        detail: matches
          ? `Tanda tangan cocok dengan kunci ${envelope.signingKeyId}.`
          : 'Tanda tangan tidak cocok dengan isi tanggapan.',
      },
    ],
    message: matches
      ? `Tanggapan ditandatangani kunci ${envelope.signingKeyId} dan isinya utuh.`
      : 'Tanda tangan ada tetapi tidak cocok; isi tanggapan mungkin berubah setelah ditandatangani.',
  };
}

export function attestationMatchesContent(
  envelope: AttestationEnvelope,
  actual: { bodyDigestHex: string; reportPublicId: string; institutionId: string },
): boolean {
  return (
    envelope.bodyDigestHex.toLowerCase() === actual.bodyDigestHex.toLowerCase() &&
    envelope.reportPublicId === actual.reportPublicId &&
    envelope.institutionId === actual.institutionId
  );
}

export function describeAttestation(verification: AttestationVerification): string {
  switch (verification.status) {
    case 'verified':
      return 'Tanggapan bertanda tangan sah.';
    case 'unsigned':
      return 'Tanggapan tanpa tanda tangan.';
    case 'signature_mismatch':
      return 'Tanda tangan tidak cocok.';
    case 'unsupported_algorithm':
      return 'Algoritma tanda tangan tidak didukung.';
    case 'payload_mismatch':
      return 'Isi tanggapan berbeda dari yang ditandatangani.';
    case 'structural_invalid':
      return 'Bentuk tanda tangan tidak sah.';
  }
}

export function attestationCaveats(): readonly string[] {
  return [
    'Tanda tangan membuktikan isi tidak berubah sejak ditandatangani, bukan membuktikan isinya benar.',
    'Tanggapan tanpa tanda tangan tetap tersimpan dan tetap tidak dapat disunting.',
    'Kunci publik ikut disimpan sehingga verifikasi tidak bergantung pada server HADIR.',
    'Mencabut kunci tidak membatalkan tanda tangan lama; ia hanya menghentikan tanda tangan baru.',
  ];
}

export function signingKeyFingerprint(publicKeyBase64: string | null): string | null {
  if (publicKeyBase64 === null) {
    return null;
  }
  const trimmed = publicKeyBase64.trim();
  if (trimmed.length < 8) {
    return null;
  }
  return `${trimmed.slice(0, 8)}…${trimmed.slice(-4)}`;
}
