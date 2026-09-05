import { ApiProperty } from '@nestjs/swagger';
import { ACCOUNT_TYPES, AccountType } from '@/domain/account';
import { Currency } from '@/domain/currency';
import { i18n } from '@/i18n/swagger';

export class AccountDto {
  @ApiProperty({ format: 'uuid', example: '11111111-1111-4111-8111-111111111111' })
  id!: string;

  @ApiProperty({ example: 'IBKR brokerage', minLength: 1, maxLength: 120 })
  name!: string;

  @ApiProperty({ enum: ACCOUNT_TYPES, example: 'brokerage' })
  type!: AccountType;

  @ApiProperty({ enum: Currency, example: Currency.USD })
  currency!: Currency;

  @ApiProperty({
    example: 1250000,
    description: i18n('dto.account.balanceCents'),
  })
  balance_cents!: number;

  @ApiProperty({ format: 'date-time', example: '2026-02-01T09:00:00.000Z' })
  created_at!: string;
}

export class AccountPageDto {
  @ApiProperty({ type: [AccountDto] })
  items!: AccountDto[];

  @ApiProperty({
    nullable: true,
    example: null,
    description: i18n('dto.page.nextCursor'),
  })
  next_cursor!: string | null;
}
