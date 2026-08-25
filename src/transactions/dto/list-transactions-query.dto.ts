import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import { PageQueryDto } from '@/shared/dto/page-query.dto';
import { i18n } from '@/i18n/swagger';

export class ListTransactionsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    example: '11111111-1111-4111-8111-111111111111',
    description: i18n('dto.transactions.accountId'),
  })
  @IsOptional()
  @IsUUID('4')
  account_id?: string;
}
