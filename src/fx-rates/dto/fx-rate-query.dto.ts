import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional } from 'class-validator';
import { i18n } from '@/i18n/swagger';

export class FxRateQueryDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-01-15',
    description: i18n('dto.fxRate.on'),
  })
  @IsOptional()
  @IsISO8601()
  on?: string;
}
