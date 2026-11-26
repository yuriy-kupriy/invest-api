import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthUser } from '@/auth/auth.types';
import { CurrentUser, Public, Roles } from '@/auth/decorators';
import { problemResponse } from '@/shared/openapi';
import {
  ChangeOrderStatusDto,
  OrderDto,
  OrderIdParamDto,
  OrderStatusDto,
  PlaceOrderDto,
  TradeSettledDto,
  TradeSettlementResultDto,
} from './dto/order.dto';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersService } from './orders.service';
import { TradeSettlementService } from './trade-settlement.service';

/**
 * An order is a `buy` row of transactions, so it is created on that resource.
 * The route lives in OrdersModule because OrdersModule already imports
 * TransactionsModule — the reverse import would be a cycle.
 */
@ApiTags('transactions')
@Controller('transactions')
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  @Roles('member')
  @ApiOperation({ summary: 'Buy an instrument: debit, order, receipt job and order.placed in one COMMIT' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiBadRequestResponse(problemResponse('Invalid body or missing Idempotency-Key'))
  @ApiForbiddenResponse(problemResponse('Account belongs to another user'))
  @ApiNotFoundResponse(problemResponse('Account or instrument not found'))
  @ApiUnprocessableEntityResponse(problemResponse('Insufficient funds, no fx rate or a reused key'))
  checkout(
    @Body() body: PlaceOrderDto,
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string,
  ): Promise<OrderDto> {
    return this.ordersService.place(body, user, idempotencyKey);
  }
}

/** The broker's side door: public, authenticated by the body's HMAC instead of a JWT. */
@ApiTags('orders')
@Controller('webhooks')
@Public()
export class TradeWebhookController {
  constructor(private readonly settlements: TradeSettlementService) {}

  @Post('trades')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Broker webhook: a trade settled (HMAC over the raw body, dedup by event_id)' })
  @ApiHeader({ name: 'X-Signature', required: true, description: 'sha256=<hex HMAC-SHA256 of the raw body>' })
  @ApiOkResponse({ type: TradeSettlementResultDto })
  @ApiUnauthorizedResponse(problemResponse('Signature does not match the body'))
  @ApiConflictResponse(problemResponse('The order is not posted (cancelled or failed)'))
  @ApiUnprocessableEntityResponse(problemResponse('Amount differs from the one frozen at checkout'))
  settle(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-signature') signature: string | undefined,
    @Body() body: TradeSettledDto,
  ): Promise<TradeSettlementResultDto> {
    return this.settlements.settle(req.rawBody, signature, body);
  }
}

function frame(event: OrderStatusEvent): string {
  return `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`;
}

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly orderEvents: OrderEventsService,
  ) {}

  @Get(':order_id')
  @ApiOperation({ summary: 'Order with its status, receipt (background) and settlement (webhook)' })
  @ApiOkResponse({ type: OrderDto })
  @ApiForbiddenResponse(problemResponse('Order belongs to another user'))
  @ApiNotFoundResponse(problemResponse('Order not found'))
  get(@Param() params: OrderIdParamDto, @CurrentUser() user: AuthUser): Promise<OrderDto> {
    return this.ordersService.get(params.order_id, user);
  }

  @Patch(':order_id/status')
  @Roles('member')
  @ApiOperation({ summary: 'Change order status; pushes order.status over WS and SSE' })
  @ApiOkResponse({ type: OrderStatusDto })
  @ApiBadRequestResponse(problemResponse('Invalid status or order id'))
  @ApiForbiddenResponse(problemResponse('Order belongs to another user'))
  @ApiNotFoundResponse(problemResponse('Order not found'))
  @ApiConflictResponse(problemResponse('The order is settled; its status is final'))
  @ApiUnprocessableEntityResponse(problemResponse('Booking the order again exceeds the balance'))
  changeStatus(
    @Param() params: OrderIdParamDto,
    @Body() body: ChangeOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ): Promise<OrderStatusDto> {
    return this.ordersService.changeStatus(params.order_id, body.status, user);
  }

  /**
   * Hand-written instead of @Sse(): Nest numbers every message without an id,
   * so the `retry:` frame would become `id: 1` and poison Last-Event-ID.
   *
   * shortcut: public — EventSource cannot send an Authorization header and the
   * payload is only {id, status}; the order id is an unguessable uuid. Upgrade
   * to a cookie or a short-lived stream ticket before exposing anything richer.
   */
  @Get(':order_id/events')
  @Public()
  @ApiOperation({ summary: 'SSE stream of order.status events; replays the buffer after Last-Event-ID' })
  @ApiProduces('text/event-stream')
  @ApiHeader({ name: 'Last-Event-ID', required: false })
  events(
    @Param() params: OrderIdParamDto,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 1000\n\n');

    // No header means "from the start of the buffer": a fresh client sees the
    // order's timeline since boot. Replay and subscribe run in one synchronous
    // tick, so no publish can fall between them — no gap, no duplicate.
    const orderId = params.order_id;
    for (const event of this.orderEvents.since(orderId, Number(lastEventId) || 0)) {
      res.write(frame(event));
    }
    const subscription = this.orderEvents.events$.subscribe((event) => {
      if (event.order_id === orderId) {
        res.write(frame(event));
      }
    });
    req.on('close', () => subscription.unsubscribe());
  }
}
