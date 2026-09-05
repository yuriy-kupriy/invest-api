import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Response } from 'express';
import { Account, AccountPage } from '@/domain/account';
import { AccountPageDto, AccountDto } from '@/accounts/dto/account.dto';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { PageQueryDto } from '@/shared/dto/page-query.dto';
import { problemResponse } from '@/shared/openapi';
import { AccountsService } from './accounts.service';
import { AccountIdParamDto } from './dto/account-id-param.dto';
import { CreateAccountDto } from './dto/create-account.dto';

@ApiTags('accounts')
@ApiExtraModels(ProblemDto)
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({ summary: i18n('accounts.list.summary') })
  @ApiOkResponse({ type: AccountPageDto })
  @ApiBadRequestResponse(problemResponse(i18n('accounts.list.badRequest')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  list(@Query() query: PageQueryDto): AccountPage {
    return this.accountsService.list(query.limit, query.cursor);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: i18n('accounts.create.summary') })
  @ApiCreatedResponse({
    type: AccountDto,
    headers: {
      Location: {
        description: i18n('accounts.create.location'),
        schema: { type: 'string', format: 'uri-reference' },
      },
    },
  })
  @ApiBadRequestResponse(problemResponse(i18n('accounts.create.badRequest')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  create(
    @Body() body: CreateAccountDto,
    @Res({ passthrough: true }) res: Response,
  ): Account {
    const account = this.accountsService.create(body);
    res.location(`/accounts/${account.id}`);
    return account;
  }

  @Get(':account_id')
  @ApiOperation({ summary: i18n('accounts.get.summary') })
  @ApiParam({ name: 'account_id', format: 'uuid' })
  @ApiOkResponse({ type: AccountDto })
  @ApiBadRequestResponse(problemResponse(i18n('accounts.get.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('accounts.get.notFound')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  get(@Param() params: AccountIdParamDto): Account {
    return this.accountsService.getById(params.account_id);
  }
}
