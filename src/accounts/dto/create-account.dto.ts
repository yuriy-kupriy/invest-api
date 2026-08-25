import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ACCOUNT_TYPES, AccountType } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { i18n } from '@/i18n/swagger';

const DEFAULT_OPENING_BALANCE_CENTS = 0;

export class CreateAccountDto {
  @ApiProperty({ example: 'IBKR brokerage', minLength: 1, maxLength: 120 })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, example: 'brokerage' })
  @IsIn([...ACCOUNT_TYPES])
  type: AccountType;

  @ApiProperty({ enum: Currency, example: Currency.USD })
  @IsEnum(Currency)
  currency: Currency;

  @ApiPropertyOptional({
    example: 1250000,
    default: DEFAULT_OPENING_BALANCE_CENTS,
    description: i18n('dto.account.openingBalance'),
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null ? DEFAULT_OPENING_BALANCE_CENTS : value,
  )
  @Type(() => Number)
  @IsInt()
  opening_balance_cents: number = DEFAULT_OPENING_BALANCE_CENTS;
}
