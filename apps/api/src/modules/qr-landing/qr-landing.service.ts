import { Injectable } from '@nestjs/common';
import type { QrLanding, QrProof } from '@hadir/contracts';
import { AppError } from '../../common/errors/app-error';
import { QrService } from '../../common/security/qr.service';
import { StopsService } from '../stops/stops.service';

@Injectable()
export class QrLandingService {
  constructor(
    private readonly stops: StopsService,
    private readonly qr: QrService,
  ) {}

  async landing(stopCode: string, proof: QrProof): Promise<QrLanding> {
    const stop = await this.stops.getByCode(stopCode);
    if (stop.status !== 'active') {
      throw new AppError('STOP_INACTIVE', {
        detail: 'Halte sedang tidak aktif.',
      });
    }
    this.qr.verify(stop.code, proof);
    return {
      stop,
      qr: {
        valid: true,
        epoch: proof.epoch,
        keyId: proof.keyId,
      },
      privacy: { locationUsed: false },
    };
  }
}