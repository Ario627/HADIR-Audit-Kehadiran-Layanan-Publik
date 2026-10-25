import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'HADIR API',
      version: '0.1.0',
      description: 'Instrumen audit warga untuk layanan bus bersubsidi',
      docs: '/v1',
      health: '/healthz',
    };
  }
}
