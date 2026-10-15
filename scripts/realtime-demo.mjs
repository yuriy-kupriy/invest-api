#!/usr/bin/env node
// HW #18: room isolation, measured. Two socket.io clients join order rooms, the
// status of order A changes over HTTP, and each client reports whether it heard
// order.status. Default run: B sits in order B's room and must NOT hear it.
// --same-room (control): B joins order A's room too and MUST hear it — the same
// code path, so a script that only ever printed B_RECEIVED=0 would fail here.
//
// Needs the app on API_URL (default http://localhost:3000) and `npm run seed:realtime`.
// Constants mirror src/seed-realtime.ts.
import { io } from 'socket.io-client';

const BASE = process.env.API_URL ?? 'http://localhost:3000';
const PASSWORD = 'demo-password-18';
const OWNER = 'rt-owner@example.com';
const OTHER = 'rt-other@example.com';
const ORDER_A = '00000018-0000-4000-8000-00000000000a';
const ORDER_B = '00000018-0000-4000-8000-00000000000b';

const sameRoom = process.argv.includes('--same-room');
const roomB = sameRoom ? ORDER_A : ORDER_B;
const expectedB = sameRoom ? 1 : 0;

// Never hang a grader: whatever happens, the script ends.
setTimeout(() => {
  console.error('timeout');
  process.exit(1);
}, 15_000).unref();

async function http(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : undefined;
}

const login = async (email) =>
  (await http('POST', '/auth/login', { body: { email, password: PASSWORD } })).access_token;

function connect(name, token) {
  const socket = io(BASE, { auth: token ? { token } : {}, transports: ['websocket'] });
  // Reconnect events live on the Manager (socket.io), not on the socket.
  socket.io.on('reconnect_attempt', (n) => console.error(`${name}: reconnect attempt ${n}`));
  return socket;
}

const join = (socket, orderId) => socket.timeout(3000).emitWithAck('join', { orderId });

const ownerToken = await login(OWNER);
const otherToken = await login(OTHER);

const a = connect('A', ownerToken);
const b = connect('B', ownerToken);
const anon = connect('anon');
const foreign = connect('foreign', otherToken);
const sockets = [a, b, anon, foreign];

let exitCode = 1;
try {
  const received = { A: 0, B: 0 };
  a.on('order.status', (e) => e.order_id === ORDER_A && (received.A = 1));
  b.on('order.status', (e) => e.order_id === ORDER_A && (received.B = 1));

  // Join and wait for the ack BEFORE changing the status, or the event can fly
  // out before the socket is in the room.
  const [ackA, ackB, ackAnon, ackForeign] = await Promise.all([
    join(a, ORDER_A),
    join(b, roomB),
    join(anon, ORDER_A),
    join(foreign, ORDER_A),
  ]);
  if (!ackA.ok || !ackB.ok) throw new Error(`join failed: A=${JSON.stringify(ackA)} B=${JSON.stringify(ackB)}`);

  // pending (maybe a no-op) then posted: always at least one real change,
  // whatever state an earlier run left the order in.
  for (const status of ['pending', 'posted']) {
    await http('PATCH', `/orders/${ORDER_A}/status`, { token: ownerToken, body: { status } });
  }

  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`ANON_JOIN=${ackAnon.ok ? 'allowed' : 'denied'}`);
  console.log(`FOREIGN_JOIN=${ackForeign.ok ? 'allowed' : 'denied'}`);
  console.log(`A_RECEIVED=${received.A}`);
  console.log(`B_RECEIVED=${received.B}`);

  const ok = received.A === 1 && received.B === expectedB && !ackAnon.ok && !ackForeign.ok;
  if (!ok) console.error(`ISOLATION VIOLATED: expected A_RECEIVED=1 B_RECEIVED=${expectedB}, joins denied`);
  exitCode = ok ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  sockets.forEach((s) => s.close());
}
process.exit(exitCode);
