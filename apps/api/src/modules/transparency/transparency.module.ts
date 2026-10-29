import { Module } from '@nestjs/common';
import { AuditModule } from '../../common/audit/audit.module';
import { ChainRepository } from '../../db/repositories/chain.repository';
import { TransparencyController } from './transparency.controller';
import { TransparencyService } from './transparency.service';

@Module({
  imports: [AuditModule],
  controllers: [TransparencyController],
  providers: [TransparencyService, ChainRepository],
  exports: [TransparencyService],
})
export class TransparencyModule {}
