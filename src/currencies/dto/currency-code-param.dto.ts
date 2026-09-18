import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

// Not @IsEnum(Currency) — see CurrencyInfo in src/domain/currency.ts.
export class CurrencyCodeParamDto {
  @ApiProperty({ pattern: '^[A-Z]{3}$', example: 'USD' })
  @Matches(/^[A-Z]{3}$/)
  code!: string;
}
