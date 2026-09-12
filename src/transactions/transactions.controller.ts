import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { TransactionBatch, TransactionPage, TransactionResponse } from '@/domain/transaction';
import { i18n } from '@/i18n/swagger';
import { ProblemDto } from '@/shared/dto/problem.dto';
import { problemResponse } from '@/shared/openapi';
import { CreateTransactionsDto } from './dto/create-transactions.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { TransactionIdParamDto } from './dto/transaction-id-param.dto';
import { TransactionBatchDto, TransactionDto, TransactionPageDto } from './dto/transaction.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiExtraModels(ProblemDto)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: i18n('transactions.list.summary') })
  @ApiOkResponse({ type: TransactionPageDto })
  @ApiBadRequestResponse(problemResponse(i18n('transactions.list.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('transactions.list.notFound')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  list(@Query() query: ListTransactionsQueryDto): Promise<TransactionPage> {
    return this.transactionsService.list(query.limit, query.cursor, query.account_id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: i18n('transactions.create.summary'),
    description: i18n('transactions.create.description'),
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: i18n('transactions.create.idempotencyKey'),
  })
  @ApiCreatedResponse({
    type: TransactionBatchDto,
    headers: {
      'Idempotency-Replay': {
        description: i18n('transactions.create.idempotencyReplay'),
        schema: { type: 'boolean' },
      },
    },
  })
  @ApiBadRequestResponse(problemResponse(i18n('transactions.create.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('transactions.create.notFound')))
  @ApiConflictResponse(problemResponse(i18n('transactions.create.conflict')))
  @ApiUnprocessableEntityResponse(problemResponse(i18n('transactions.create.unprocessable')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  create(@Body() body: CreateTransactionsDto): Promise<TransactionBatch> {
    return this.transactionsService.create(body);
  }

  @Get(':transaction_id')
  @ApiOperation({ summary: i18n('transactions.get.summary') })
  @ApiParam({ name: 'transaction_id', format: 'uuid' })
  @ApiOkResponse({ type: TransactionDto })
  @ApiBadRequestResponse(problemResponse(i18n('transactions.get.badRequest')))
  @ApiNotFoundResponse(problemResponse(i18n('transactions.get.notFound')))
  @ApiInternalServerErrorResponse(problemResponse(i18n('errors.internal')))
  get(@Param() params: TransactionIdParamDto): Promise<TransactionResponse> {
    return this.transactionsService.getById(params.transaction_id);
  }
}
