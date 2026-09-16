import { Controller, Get, Header, Param } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrencyInfo } from '@/domain/currency';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { problemResponse } from '@/shared/openapi';
import { CurrenciesService } from './currencies.service';
import { CurrencyCodeParamDto } from './dto/currency-code-param.dto';
import { CurrencyDto } from './dto/currency.dto';

const CACHE_CONTROL = 'public, max-age=3600';

@ApiTags('currencies')
@ApiExtraModels(ProblemDto)
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({ summary: i18n('currencies.list.summary') })
  @ApiOkResponse({ type: [CurrencyDto] })
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  list(): Promise<CurrencyInfo[]> {
    return this.currenciesService.list();
  }

  @Get(':code')
  @Header('Cache-Control', CACHE_CONTROL)
  @ApiOperation({ summary: i18n('currencies.get.summary') })
  @ApiOkResponse({ type: CurrencyDto })
  @ApiBadRequestResponse(problemResponse(i18n('currencies.get.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('currencies.get.notFound')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  get(@Param() params: CurrencyCodeParamDto): Promise<CurrencyInfo> {
    return this.currenciesService.getByCode(params.code);
  }
}
