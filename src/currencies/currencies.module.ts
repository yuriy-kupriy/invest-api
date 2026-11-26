import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Currency as CurrencyEntity } from '@/entities/currency.entity';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesRepository } from './currencies.repository';
import { CurrenciesService } from './currencies.service';

@Module({
  imports: [TypeOrmModule.forFeature([CurrencyEntity])],
  controllers: [CurrenciesController],
  providers: [CurrenciesService, CurrenciesRepository],
})
export class CurrenciesModule {}
