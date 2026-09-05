import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, MIN_PAGE_LIMIT } from '@/shared/pagination';
import { i18n } from '@/i18n/swagger';

export class PageQueryDto {
  @ApiPropertyOptional({
    default: DEFAULT_PAGE_LIMIT,
    minimum: MIN_PAGE_LIMIT,
    maximum: MAX_PAGE_LIMIT,
    description: i18n('dto.page.limit'),
  })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === '' ? DEFAULT_PAGE_LIMIT : Number(value),
  )
  @IsInt()
  @Min(MIN_PAGE_LIMIT)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 512,
    description: i18n('dto.page.cursor'),
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  cursor?: string;
}
