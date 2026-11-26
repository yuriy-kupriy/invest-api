import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';
import { TRANSACTION_STATUSES, TransactionStatus } from '@/entities/transaction.entity';

export class OrderIdParamDto {
  @ApiProperty({ format: 'uuid', example: '00000018-0000-4000-8000-00000000000a' })
  @IsUUID('4')
  order_id!: string;
}

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: TRANSACTION_STATUSES })
  @IsIn(TRANSACTION_STATUSES)
  status!: TransactionStatus;
}

export class OrderStatusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: TRANSACTION_STATUSES })
  status!: TransactionStatus;
}

export class PlaceOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Account the cost is debited from; must be yours' })
  @IsUUID('4')
  account_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  instrument_id!: string;

  @ApiProperty({ minimum: 1, maximum: 1_000_000, description: 'Whole units' })
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  // quantity × unit_price_cents stays far below Number.MAX_SAFE_INTEGER.
  @ApiProperty({ minimum: 1, maximum: 1_000_000_000, description: "Price of one unit in the account's cents" })
  @IsInt()
  @Min(1)
  @Max(1_000_000_000)
  unit_price_cents!: number;
}

export class OrderDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  account_id!: string;

  @ApiProperty({ format: 'uuid' })
  instrument_id!: string;

  @ApiProperty({ enum: TRANSACTION_STATUSES })
  status!: TransactionStatus;

  @ApiProperty()
  amount_cents!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  quantity_micro!: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set by the order.placed consumer' })
  receipt_issued_at!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'Set by the trade-settlement webhook' })
  settled_at!: string | null;
}

export class TradeSettledDto {
  @ApiProperty({ format: 'uuid', description: "The broker's event id — the dedup key" })
  @IsUUID()
  event_id!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  order_id!: string;

  @ApiProperty({ minimum: 1, description: 'Must equal the amount frozen at checkout' })
  @IsInt()
  @Min(1)
  amount_cents!: number;
}

export class TradeSettlementResultDto {
  @ApiProperty({ format: 'uuid' })
  order_id!: string;

  @ApiProperty({ enum: ['settled', 'duplicate', 'already-settled'] })
  outcome!: 'settled' | 'duplicate' | 'already-settled';
}
