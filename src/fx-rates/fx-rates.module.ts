import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppTypeOrmModule } from '@/db/typeorm.module';
import { FxRate } from '@/entities/fx-rate.entity';
import { FxRateRepository } from './fx-rate.repository';
import { FxRatesController } from './fx-rates.controller';
import { FxRatesService } from './fx-rates.service';

@Module({
  imports: [AppTypeOrmModule, TypeOrmModule.forFeature([FxRate])],
  controllers: [FxRatesController],
  providers: [FxRatesService, FxRateRepository],
  exports: [FxRatesService],
})
export class FxRatesModule {}
