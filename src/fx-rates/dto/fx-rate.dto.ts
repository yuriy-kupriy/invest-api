import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '@/domain/currency';

export class FxRateDto {
  @ApiProperty({ enum: Currency, example: Currency.USD })
  currency!: Currency;

  @ApiProperty({ example: '41.6000000000', description: 'UAH per one unit of `currency`.' })
  rate!: string;

  @ApiProperty({ format: 'date', example: '2026-01-02' })
  rate_date!: string;

  @ApiProperty({ example: 'seed', description: 'Provider this rate came from — part of the fx_rate primary key.' })
  source!: string;
}
