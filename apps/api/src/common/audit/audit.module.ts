import { Module } from '@nestjs/common';
import { AuditRepository } from '../../db/repositories/audit.repository';
import { AuditService } from './audit.service';

@Module({
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}