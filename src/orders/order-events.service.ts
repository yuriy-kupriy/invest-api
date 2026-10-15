import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { TransactionStatus } from '@/entities/transaction.entity';

export interface OrderStatusEvent {
  /** Process-wide, strictly increasing — the SSE `id:` and the Last-Event-ID cursor. */
  id: number;
  order_id: string;
  status: TransactionStatus;
  changed_at: string;
}

const BUFFER_SIZE = 1000;

/**
 * The one event bus both transports read: the WS gateway fans it out to rooms,
 * the SSE controller filters it per order and replays the buffer on reconnect.
 *
 * shortcut: buffer and sequence live in this process — lost on restart, not
 * shared between instances; upgrade to Redis Streams (XADD/XRANGE) when the API
 * runs more than one replica.
 */
@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderStatusEvent>();
  private readonly buffer: OrderStatusEvent[] = [];
  private seq = 0;

  readonly events$: Observable<OrderStatusEvent> = this.subject.asObservable();

  publish(orderId: string, status: TransactionStatus): OrderStatusEvent {
    const event = { id: ++this.seq, order_id: orderId, status, changed_at: new Date().toISOString() };
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) {
      this.buffer.shift();
    }
    this.subject.next(event);
    return event;
  }

  /** Buffered events of one order with id > lastId, oldest first. */
  since(orderId: string, lastId: number): OrderStatusEvent[] {
    return this.buffer.filter((e) => e.order_id === orderId && e.id > lastId);
  }
}
