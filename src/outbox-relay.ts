import { writeSync } from 'node:fs';
import { connect } from 'amqplib';
import { DataSource } from 'typeorm';
import { relayBatch } from './broker/relay';
import { brokerUrl } from './broker/topology';
import { dataSourceOptions } from './data-source';

/**
 * HW #22 relay as its own process (`npm run relay`): polls the outbox and moves
 * unpublished events to the broker. A separate process is what lets
 * demo:crash-relay kill it for real.
 */

// writeSync, not console.log: a SIGKILL right after a log line must not take it along.
function report(line: string): void {
  writeSync(1, `relay ${line}\n`);
}

const IDLE_MS = 200;

async function main(): Promise<void> {
  const ds = await new DataSource(dataSourceOptions).initialize();
  const conn = await connect(brokerUrl());
  const ch = await conn.createConfirmChannel();

  // Fault injection for demo:crash-relay: die after the broker confirmed the
  // publish, before UPDATE published_at. The OS closes the DB socket and
  // Postgres rolls the open transaction back — the row is unpublished again.
  const crashAfterPublish = process.env.CRASH_AFTER_PUBLISH === '1';

  report('ready');
  for (;;) {
    const published = await relayBatch(ds, ch, 100, (event) => {
      report(`published messageId=${event.eventId}`);
      if (crashAfterPublish) {
        report('crashing before UPDATE published_at');
        process.kill(process.pid, 'SIGKILL');
      }
    });
    if (published > 0) report(`marked count=${published}`);
    else await new Promise((resolve) => setTimeout(resolve, IDLE_MS));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
