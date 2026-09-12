import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { problemResponse } from '@/shared/openapi';
import { FxRateCurrencyParamDto } from './dto/fx-rate-currency-param.dto';
import { FxRateDto } from './dto/fx-rate.dto';
import { FxRateQueryDto } from './dto/fx-rate-query.dto';
import { EffectiveFxRate, FxRatesService } from './fx-rates.service';

function toFxRateDto(rate: EffectiveFxRate): FxRateDto {
  return {
    currency: rate.currency as FxRateDto['currency'],
    rate: rate.rate,
    rate_date: rate.rateDate,
    source: rate.source,
  };
}

@ApiTags('fx-rates')
@ApiExtraModels(ProblemDto)
@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly fxRatesService: FxRatesService) {}

  @Get(':currency/latest')
  @ApiOperation({ summary: i18n('fxRates.get.summary') })
  @ApiOkResponse({ type: FxRateDto })
  @ApiBadRequestResponse(problemResponse(i18n('fxRates.get.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('fxRates.get.notFound')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  async getLatest(
    @Param() params: FxRateCurrencyParamDto,
    @Query() query: FxRateQueryDto,
  ): Promise<FxRateDto> {
    const on = query.on ? new Date(query.on) : new Date();
    const rate = await this.fxRatesService.getLatest(params.currency, on);
    return toFxRateDto(rate);
  }
}
