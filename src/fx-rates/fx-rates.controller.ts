import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { problemResponse } from '@/shared/openapi';
import { toDateOnly } from './fx-rate.repository';
import { FxRateCurrencyParamDto } from './dto/fx-rate-currency-param.dto';
import { FxRateDto } from './dto/fx-rate.dto';
import { FxRateQueryDto } from './dto/fx-rate-query.dto';
import { EffectiveFxRate, FxRatesService } from './fx-rates.service';

/** A closed day's rate only ever changes if a provider publishes a correction. */
const PAST_DAY_MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Today's rate is still expected to move (the day's quote may not be published
 * yet), and the `on`-less URL is the same string tomorrow — so this must stay
 * well short of a day either way.
 */
const TODAY_MAX_AGE_SECONDS = 60;

function toFxRateDto(rate: EffectiveFxRate): FxRateDto {
  return {
    currency: rate.currency as FxRateDto['currency'],
    rate: rate.rate,
    rate_date: rate.rateDate,
    source: rate.source,
  };
}

function cacheControlFor(on: Date): string {
  const isClosedDay = toDateOnly(on) < toDateOnly(new Date());
  return `public, max-age=${isClosedDay ? PAST_DAY_MAX_AGE_SECONDS : TODAY_MAX_AGE_SECONDS}`;
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
    @Res({ passthrough: true }) res: Response,
  ): Promise<FxRateDto> {
    // Set first, so an error response keeps it: a 404 here means "no rate on or
    // before that date *yet*", and a backfill can turn it into a 200 at any
    // time — RFC 9111 lets caches store a 404 heuristically, so say no.
    res.setHeader('Cache-Control', 'no-store');

    const on = query.on ? new Date(query.on) : new Date();
    const rate = await this.fxRatesService.getLatest(params.currency, on);

    // Caching a read is safe precisely because the write path never comes
    // through here: TransactionsRepository.saveMany() reads the rate straight
    // from the database, so a stale response can never be frozen into a
    // transaction's fx_rate snapshot. Express already supplies ETag and
    // answers If-None-Match with 304; this adds the missing freshness half.
    res.setHeader('Cache-Control', cacheControlFor(on));
    return toFxRateDto(rate);
  }
}
