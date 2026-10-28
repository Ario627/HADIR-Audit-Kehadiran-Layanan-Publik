import { Module } from '@nestjs/common';
import { resolve } from 'node:path';
import { AuditModule } from '../../common/audit/audit.module';
import { env } from '../../common/config/env';
import { LocalObjectStorage, OBJECT_STORAGE } from '../../common/storage/object-storage';
import { UploadsRepository } from '../../db/repositories/uploads.repository';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  imports: [AuditModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    UploadsRepository,
    {
      provide: OBJECT_STORAGE,
      useFactory: () => new LocalObjectStorage(resolve(env.uploadRoot)),
    },
  ],
  exports: [UploadsService, OBJECT_STORAGE],
})
export class UploadsModule {}
