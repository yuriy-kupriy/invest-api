import { HttpStatus, Injectable } from '@nestjs/common';
import { CurrencyInfo } from '@/domain/currency';
import { problem } from '@/shared/problem.exception';
import { CurrenciesRepository } from './currencies.repository';

@Injectable()
export class CurrenciesService {
  constructor(private readonly currenciesRepo: CurrenciesRepository) {}

  list(): Promise<CurrencyInfo[]> {
    return this.currenciesRepo.findAll();
  }

  async getByCode(code: string): Promise<CurrencyInfo> {
    const currency = await this.currenciesRepo.findByCode(code);
    if (!currency) {
      throw problem(HttpStatus.NOT_FOUND, 'currency-not-found', `no currency with code ${code}`);
    }
    return currency;
  }
}
