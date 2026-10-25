import { Body, Controller, Get, Headers, Param, Patch, Req, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { ChangeOrderStatusDto, OrderIdParamDto, OrderStatusDto } from './dto/order.dto';
import { OrderEventsService, OrderStatusEvent } from './order-events.service';
import { OrdersService } from './orders.service';

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

  @Patch(':order_id/status')
  @Roles('member')
  @ApiOperation({ summary: 'Change order status; pushes order.status over WS and SSE' })
  @ApiOkResponse({ type: OrderStatusDto })
  @ApiBadRequestResponse(problemResponse('Invalid status or order id'))
  @ApiForbiddenResponse(problemResponse('Order belongs to another user'))
  @ApiNotFoundResponse(problemResponse('Order not found'))
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
