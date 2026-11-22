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
import { Public } from '@/auth/decorators';

@ApiTags('health')
@ApiExtraModels(ProblemDto)
@Public()
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

  // Separate from liveness on purpose: "do not send me traffic" must never be
  // read as "kill me", or a draining pod gets restarted mid-drain.
  @Get('ready')
  @ApiOperation({ summary: i18n('health.ready.summary') })
  @ApiOkResponse({ type: HealthDto })
  @ApiServiceUnavailableResponse(problemResponse(i18n('health.ready.draining')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  readiness(): HealthDto {
    return this.healthService.readiness();
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
