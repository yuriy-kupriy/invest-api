import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Currency } from '@/domain/currency';
import { TRANSACTION_TYPES, TransactionType } from '@/domain/transaction';
import { i18n } from '@/i18n/swagger';

export class TransactionEntryDto {
  @ApiProperty({ format: 'uuid', example: '11111111-1111-4111-8111-111111111111' })
  @IsUUID('4')
  account_id: string;

  @ApiProperty({ enum: TRANSACTION_TYPES, example: 'expense' })
  @IsIn([...TRANSACTION_TYPES])
  type: TransactionType;

  @ApiProperty({ example: 4599, minimum: 0 })
  @IsInt()
  @Min(0)
  amount_cents: number;

  @ApiProperty({ enum: Currency, example: Currency.UAH })
  @IsEnum(Currency)
  currency: Currency;

  @ApiProperty({ format: 'date-time', example: '2026-08-25T10:00:00.000Z' })
  @IsISO8601()
  occurred_at: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 500, example: 'Lunch' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 20, example: 'VOO' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  instrument_symbol?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 10000000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  quantity_micro?: number | null;
}

export class CreateTransactionsDto {
  @ApiProperty({
    type: [TransactionEntryDto],
    minItems: 1,
    maxItems: 100,
    description: i18n('dto.transaction.entries'),
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => TransactionEntryDto)
  entries: TransactionEntryDto[];
}
