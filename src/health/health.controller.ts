import { Controller, Get } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { problemResponse } from '@/shared/openapi';
import { DbHealthDto, HealthDto } from './dto/health.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@ApiExtraModels(ProblemDto)
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: i18n('health.liveness.summary') })
  @ApiOkResponse({ type: HealthDto })
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  liveness(): HealthDto {
    return this.healthService.liveness();
  }

  @Get('db')
  @ApiOperation({ summary: i18n('health.db.summary') })
  @ApiOkResponse({ type: DbHealthDto })
  @ApiServiceUnavailableResponse(problemResponse(i18n('health.db.unavailable')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  database(): Promise<DbHealthDto> {
    return this.healthService.database();
  }
}
