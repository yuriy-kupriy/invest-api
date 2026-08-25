import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '@/domain/currency';
import { TRANSACTION_TYPES, TransactionType } from '@/domain/transaction';
import { i18n } from '@/i18n/swagger';

export class TransactionDto {
  @ApiProperty({ format: 'uuid', example: 'aaaaaaaa-0000-4000-8000-000000000001' })
  id!: string;

  @ApiProperty({ format: 'uuid', example: '11111111-1111-4111-8111-111111111111' })
  account_id!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES, example: 'expense' })
  type!: TransactionType;

  @ApiProperty({
    example: 4599,
    minimum: 0,
    description: i18n('dto.transaction.amountCents'),
  })
  amount_cents!: number;

  @ApiProperty({ enum: Currency, example: Currency.UAH })
  currency!: Currency;

  @ApiProperty({
    format: 'date-time',
    example: '2026-08-20T12:30:00.000Z',
    description: i18n('dto.transaction.occurredAt'),
  })
  occurred_at!: string;

  @ApiProperty({ nullable: true, example: 'Coffee and breakfast', maxLength: 500 })
  description!: string | null;

  @ApiProperty({ nullable: true, example: 'VOO', maxLength: 20 })
  instrument_symbol!: string | null;

  @ApiProperty({
    nullable: true,
    example: 10000000,
    description: i18n('dto.transaction.quantityMicro'),
  })
  quantity_micro!: number | null;

  @ApiProperty({ format: 'date-time', example: '2026-08-20T12:31:00.000Z' })
  created_at!: string;
}

export class TransactionPageDto {
  @ApiProperty({ type: [TransactionDto] })
  items!: TransactionDto[];

  @ApiProperty({
    nullable: true,
    example: null,
    description: i18n('dto.page.nextCursor'),
  })
  next_cursor!: string | null;
}

export class TransactionBatchDto {
  @ApiProperty({ type: [TransactionDto] })
  transactions!: TransactionDto[];
}
