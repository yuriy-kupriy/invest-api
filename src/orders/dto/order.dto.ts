import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { TransactionStatus } from '@/entities/transaction.entity';

const STATUSES: TransactionStatus[] = ['pending', 'posted', 'failed'];

export class OrderIdParamDto {
  @ApiProperty({ format: 'uuid', example: '00000018-0000-4000-8000-00000000000a' })
  @IsUUID('4')
  order_id!: string;
}

export class ChangeOrderStatusDto {
  @ApiProperty({ enum: STATUSES })
  @IsIn(STATUSES)
  status!: TransactionStatus;
}

export class OrderStatusDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: STATUSES })
  status!: TransactionStatus;
}
