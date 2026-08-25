import { ApiProperty } from '@nestjs/swagger';
import { i18n } from '@/i18n/swagger';

export class ProblemErrorDto {
  @ApiProperty({ example: '/body/entries' })
  path!: string;

  @ApiProperty({ example: 'must NOT have fewer than 1 items' })
  message!: string;
}

export class ProblemDto {
  @ApiProperty({ example: 'https://api.invest.example/problems/account-not-found' })
  type!: string;

  @ApiProperty({ example: i18n('dto.problem.title') })
  title!: string;

  @ApiProperty({ example: 404 })
  status!: number;

  @ApiProperty({ example: i18n('dto.problem.detail') })
  detail!: string;

  @ApiProperty({ example: '/accounts/00000000-0000-4000-8000-000000000000' })
  instance!: string;

  @ApiProperty({ required: false, example: 'account-not-found' })
  code?: string;

  @ApiProperty({ required: false, type: [ProblemErrorDto] })
  errors?: ProblemErrorDto[];
}
