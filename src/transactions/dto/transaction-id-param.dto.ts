import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class TransactionIdParamDto {
  @ApiProperty({ format: 'uuid', example: 'aaaaaaaa-0000-4000-8000-000000000001' })
  @IsUUID('4')
  transaction_id: string;
}
