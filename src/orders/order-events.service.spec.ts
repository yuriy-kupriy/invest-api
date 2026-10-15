import { OrderEventsService } from './order-events.service';

describe('OrderEventsService', () => {
  it('numbers events monotonically and replays only one order after the cursor', () => {
    const bus = new OrderEventsService();
    const seen: number[] = [];
    bus.events$.subscribe((e) => seen.push(e.id));

    bus.publish('a', 'posted');
    bus.publish('b', 'posted');
    bus.publish('a', 'failed');
    bus.publish('a', 'pending');

    expect(seen).toEqual([1, 2, 3, 4]);
    expect(bus.since('a', 0).map((e) => e.id)).toEqual([1, 3, 4]);
    expect(bus.since('a', 3).map((e) => [e.id, e.status])).toEqual([[4, 'pending']]);
    expect(bus.since('b', 2)).toEqual([]);
  });

  it('keeps only the newest 1000 events', () => {
    const bus = new OrderEventsService();
    for (let i = 0; i < 1005; i++) bus.publish('a', 'posted');
    const kept = bus.since('a', 0);
    expect(kept).toHaveLength(1000);
    expect(kept[0].id).toBe(6);
  });
});
