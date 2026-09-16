import { ApiProperty } from '@nestjs/swagger';
import { i18n } from '@/i18n/swagger';

export class CurrencyDto {
  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'USD', description: i18n('dto.currency.code') })
  code!: string;

  @ApiProperty({ example: 840, description: i18n('dto.currency.numericCode') })
  numeric_code!: number;

  @ApiProperty({ example: 2, minimum: 0, maximum: 6, description: i18n('dto.currency.exponent') })
  exponent!: number;

  @ApiProperty({ example: 'United States dollar' })
  name!: string;
}
