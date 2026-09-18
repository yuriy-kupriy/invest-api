import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency as CurrencyEntity } from '@/entities/currency.entity';
import { CurrencyInfo } from '@/domain/currency';

function toDomain(entity: CurrencyEntity): CurrencyInfo {
  return {
    code: entity.code,
    numeric_code: entity.numericCode,
    exponent: entity.exponent,
    name: entity.name,
  };
}

@Injectable()
export class CurrenciesRepository {
  constructor(@InjectRepository(CurrencyEntity) private readonly repo: Repository<CurrencyEntity>) {}

  async findAll(): Promise<CurrencyInfo[]> {
    const entities = await this.repo.find({ order: { code: 'ASC' } });
    return entities.map(toDomain);
  }

  async findByCode(code: string): Promise<CurrencyInfo | undefined> {
    const entity = await this.repo.findOne({ where: { code } });
    return entity ? toDomain(entity) : undefined;
  }
}
