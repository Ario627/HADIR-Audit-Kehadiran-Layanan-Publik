import { Injectable } from '@nestjs/common';
import type { QrProof } from '@hadir/contracts';
import { env } from '../config/env';
import { parseQrKeyring, verifyQrProof, type QrKeyring } from './qr';

@Injectable()
export class QrService {
  private readonly keyring: QrKeyring;

  constructor() {
    this.keyring = parseQrKeyring(env.qrKeyringJson);
  }

  verify(stopCode: string, proof: QrProof): void {
    verifyQrProof(this.keyring, stopCode, proof);
  }

  get configured(): boolean {
    return this.keyring.size > 0;
  }
}