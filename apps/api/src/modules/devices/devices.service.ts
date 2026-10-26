import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { DevicesRepository } from '../../db/repositories/devices.repository';

const DEVICE_HASH_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class DevicesService {
  constructor(private readonly devices: DevicesRepository) {}

  async bootstrap(deviceHash: string): Promise<void> {
    if (!DEVICE_HASH_PATTERN.test(deviceHash)) {
      throw new AppError('UNAUTHENTICATED', {
        detail: 'Identitas perangkat tidak valid.',
      });
    }
    const device = await this.devices.upsert(deviceHash);
    if (device.revokedAt !== null) {
      throw new AppError('FORBIDDEN', {
        detail: 'Perangkat ini diblokir.',
      });
    }
  }
}