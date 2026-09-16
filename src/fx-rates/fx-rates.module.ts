import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { FxRate } from '@/entities/fx-rate.entity';
import { FxRateCache } from './fx-rate.cache';
import { FxRateRepository } from './fx-rate.repository';
import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';
import { FxSyncService } from './fx-sync.service';
import { NbuClient } from './nbu-client.service';

@Module({
  imports: [AppTypeOrmModule, TypeOrmModule.forFeature([FxRate])],
  controllers: [FxRatesController],
  providers: [FxRatesService, FxRateRepository, FxRateCache, FxSyncService, NbuClient],
  exports: [FxRatesService],
})
export class FxRatesModule {}
