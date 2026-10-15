// Browser-hosted multiplayer (artifact room transport) tested against an in-memory room model
// with latency, jitter and dropped presence frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MockHub } from './room-mock.js';
import { RoomHost, RoomClientConn, findPublicMatch } from '../client/net/room.js';
import { ClientSession } from '../shared/client.js';
import { neutralInput } from '../shared/car.js';
import { PHYSICS, MATCH } from '../shared/config.js';
import { setLogSink } from '../shared/log.js';
import { waitFor, sleep } from './net-harness.js';

const logs = [];
setLogSink((e) => logs.push(e));

async function hostAndJoin(hub, opts = {}) {
  const hp = hub.page();
  const rh = new RoomHost({ room: hp, mode: opts.mode || '1v1', isPrivate: true, fill: opts.fill || 'off', arena: 'stadium' });
  await rh.open();
  const hs = new ClientSession({ conn: rh.local.conn, name: 'Host', cos: { body: 'vanta', paint: 0xff0000 } });
  rh.local.attach(hs); hs.input = neutralInput();
  const cp = hub.page();
  const conn = new RoomClientConn(cp, rh.code);
  const cs = new ClientSession({ conn, name: 'Guest', cos: { body: 'wisp' } });
  conn.attach(cs); cs.input = neutralInput();
  await conn.open();
  return { rh, hs, cs, conn };
}

async function pump(rh, sessions, ms, perFrame) {
  const t0 = performance.now(); let last = t0, acc = 0;
  while (performance.now() - t0 < ms) {
    await sleep(8);
    const now = performance.now(), dt = (now - last) / 1000; last = now;
    for (const s of sessions) { perFrame?.(s); s.update(dt, s.input); }
    acc += dt;
    while (acc >= PHYSICS.dt) { acc -= PHYSICS.dt; rh.tick(); }
    rh.publish();
  }
}

test('browser host: join by code, lobby, ready, match, goals replicate once, presence stays under 4 KiB', async () => {
  const hub = new MockHub({ latency: 50, jitter: 30, drop: 0.1 });
  try {
    const { rh, hs, cs } = await hostAndJoin(hub);
    await pump(rh, [hs, cs], 600);
    await waitFor(() => cs.pid && cs.lobby && cs.lobby.players.length === 2, 4000);
    assert.equal(cs.code, rh.code);
    assert.equal(cs.lobby.players.find((p) => p.pid === cs.pid).name, 'Guest');
    hs.ready(true); cs.ready(true);
    await pump(rh, [hs, cs], 500);
    assert.ok(rh.host.players.get(cs.pid).ready, 'guest ready reached the host');
    hs.start();
    await pump(rh, [hs, cs], 800);
    assert.ok(cs.world && cs.snapCount > 3, 'guest receives snapshots');
    assert.deepEqual(cs.roster.find((r) => r.pid === hs.pid).cos.body, 'vanta', 'cosmetics replicated');
    // guest drives; host must see the car move (inputs flow through presence)
    await pump(rh, [hs, cs], MATCH.countdown * 1000);
    const start = rh.host.world.car(cs.pid).pos.clone();
    cs.input.throttle = 1;
    await pump(rh, [hs, cs], 1500);
    const moved = rh.host.world.car(cs.pid).pos.dist(start);
    assert.ok(moved > 5, 'guest inputs drive its car on the host: ' + moved.toFixed(2));
    // a goal on the authority reaches the guest exactly once
    const w = rh.host.world;
    w.ball.pos.set(0, 2, -w.arena.halfL + 3); w.ball.vel.set(0, 0, -20);
    let goals = 0;
    for (let i = 0; i < 15; i++) { await pump(rh, [hs, cs], 100); goals += cs.drainEvents().filter((e) => e.type === 'goal').length; }
    assert.deepEqual(rh.host.world.match.score, [0, 1]);
    assert.deepEqual(cs.world.match.score, [0, 1]);
    assert.equal(goals, 1);
    assert.ok(!logs.some((e) => /presence publish failed/.test(e.msg)), 'no oversize presence');
    // host leaves: guest is told
    rh.close();
    await pump(rh, [cs], 800);
    assert.ok(cs.closed, 'guest notified that the host left: ' + cs.closed);
  } finally { hub.stop(); }
});

test('browser host: 4v4 snapshot + roster fits the presence budget', async () => {
  const hub = new MockHub({ latency: 20, jitter: 5 });
  try {
    const { rh, hs, cs } = await hostAndJoin(hub, { mode: '4v4', fill: 'elite' });
    await pump(rh, [hs, cs], 600);
    await waitFor(() => cs.pid, 3000);
    hs.ready(true); cs.ready(true);
    await pump(rh, [hs, cs], 400);
    hs.start();
    await pump(rh, [hs, cs], MATCH.countdown * 1000 + 2500);
    assert.equal(rh.host.world.cars.length, 8);
    const presence = rh.joined._member.presence;
    const size = JSON.stringify(presence).length;
    assert.ok(size < 4096, 'host presence size ' + size);
    assert.ok(cs.snapCount > 20, 'snapshots flowing: ' + cs.snapCount);
  } finally { hub.stop(); }
});

test('browser host: an unknown code is rejected', async () => {
  const hub = new MockHub();
  try {
    const cp = hub.page();
    const conn = new RoomClientConn(cp, 'ZZZZZZ');
    const cs = new ClientSession({ conn, name: 'Lost', cos: {} });
    conn.attach(cs);
    await conn.open(800);
    await waitFor(() => cs.closed, 3000);
    assert.equal(cs.closed, 'bad_code');
    assert.ok(cs.events.some((e) => e.type === 'error' && e.code === 'bad_code'));
  } finally { hub.stop(); }
});

test('room matchmaking finds an advertised public lobby', async () => {
  const hub = new MockHub({ latency: 20 });
  try {
    const hp = hub.page();
    const rh = new RoomHost({ room: hp, mode: '2v2', isPrivate: false, fill: 'pro', arena: 'stadium' });
    await rh.open();
    rh.advertise(hp);
    const seeker = hub.page();
    await sleep(200);
    const r = await findPublicMatch(seeker, 'soccar:2v2', null, 1500);
    assert.equal(r.join, rh.code);
    const none = await findPublicMatch(seeker, 'soccar:1v1', null, 600);
    assert.equal(none.host, true, 'no lobby for that mode -> host one');
  } finally { hub.stop(); }
});
