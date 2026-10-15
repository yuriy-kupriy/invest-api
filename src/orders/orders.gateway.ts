import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import { Subscription } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { Public } from '@/auth/decorators';
import { TokensService } from '@/auth/tokens.service';
import { ProblemException } from '@/shared/problem.exception';
import { TransactionsService } from '@/transactions/transactions.service';
import { OrderEventsService } from './order-events.service';

type JoinAck = { ok: true; room: string } | { ok: false; error: string };

const orderRoom = (orderId: string): string => `orders:${orderId}`;

/**
 * Same port as HTTP (engine.io takes /socket.io/ before Express sees it).
 * @Public(): the global JwtAuthGuard reads an HTTP Authorization header that a
 * socket message does not have — `join` verifies the handshake token instead.
 */
@Public()
@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersGateway.name);
  private subscription?: Subscription;

  @WebSocketServer()
  private readonly server!: Server;

  constructor(
    private readonly orderEvents: OrderEventsService,
    private readonly tokens: TokensService,
    private readonly transactions: TransactionsService,
  ) {}

  afterInit(): void {
    // Only the order's room, never server.emit: another user's socket must not hear it.
    this.subscription = this.orderEvents.events$.subscribe((event) =>
      this.server.to(orderRoom(event.order_id)).emit('order.status', event),
    );
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }

  /** Acks instead of throwing: the app's exception filter speaks HTTP problem+json, not socket.io. */
  @SubscribeMessage('join')
  async join(@ConnectedSocket() client: Socket, @MessageBody() body: { orderId?: unknown }): Promise<JoinAck> {
    const token: unknown = client.handshake.auth?.token;
    const user = typeof token === 'string' ? await this.tokens.verifyAccess(token).catch(() => null) : null;
    if (!user) {
      return { ok: false, error: 'unauthorized' };
    }

    // Same rule as OrderIdParamDto; anything else would only reach Postgres to fail there.
    const orderId = body?.orderId;
    if (typeof orderId !== 'string' || !isUUID(orderId, '4')) {
      return { ok: false, error: 'transaction-not-found' };
    }
    try {
      // Already 404 for a missing row and 403 for someone else's.
      await this.transactions.getById(orderId, user);
    } catch (error) {
      if (error instanceof ProblemException) {
        return { ok: false, error: error.code };
      }
      // Not rethrown: the global filter writes HTTP responses and has none to write to here.
      this.logger.error(`join ${orderId}: ${error instanceof Error ? error.message : error}`);
      return { ok: false, error: 'internal' };
    }

    const room = orderRoom(orderId);
    await client.join(room);
    return { ok: true, room };
  }
}
