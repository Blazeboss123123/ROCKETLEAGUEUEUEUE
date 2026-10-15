// Multiplayer tests against a real dedicated server over real WebSockets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/server.js';
import { connectClient, waitFor, run, sleep } from './net-harness.js';
import { setQuiet } from '../shared/log.js';
import { MATCH } from '../shared/config.js';

setQuiet(true);

async function privateMatch(srv, mode = '1v1', fill = 'off', names = ['Ana', 'Ben']) {
  const a = connectClient(srv.port, `op=create&mode=${mode}&fill=${fill}`, names[0]);
  await waitFor(() => a.code && a.lobby);
  const b = connectClient(srv.port, 'op=join&code=' + a.code, names[1]);
  await waitFor(() => b.pid && a.lobby.players.length === 2);
  a.ready(true); b.ready(true);
  await waitFor(() => a.lobby.players.every((p) => p.ready));
  a.start();
  await waitFor(() => a.world && b.world && a.snapCount > 2 && b.snapCount > 2);
  return { a, b, rec: srv.sessions.get(a.code) };
}

function rawSocket(port, query) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?${query}`);
  const msgs = [];
  ws.onmessage = (e) => msgs.push(JSON.parse(e.data));
  const opened = new Promise((r) => { ws.onopen = r; });
  let closed = false; ws.onclose = () => { closed = true; };
  return { ws, msgs, opened, isClosed: () => closed, send: (m) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)) };
}

test('two clients join the same match, see consistent state, goals count once', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const { a, b, rec } = await privateMatch(srv);
    assert.equal(a.code, b.code);
    assert.notEqual(a.pid, b.pid);
    const host = rec.host;
    await run([a, b], MATCH.countdown * 1000 + 300);
    assert.equal(host.world.match.state, 'live');
    // put the ball into orange's goal on the authority
    host.world.ball.pos.set(0, 2, host.world.arena.halfL - 3); host.world.ball.vel.set(0, 0, 20);
    let goalsA = 0, goalsB = 0;
    const count = () => { for (const e of a.events) if (e.type === 'goal') goalsA++; for (const e of b.events) if (e.type === 'goal') goalsB++; a.events = []; b.events = []; };
    for (let i = 0; i < 20; i++) { await run([a, b], 100); count(); }
    assert.deepEqual(host.world.match.score, [1, 0]);
    assert.deepEqual(a.world.match.score, [1, 0]);
    assert.deepEqual(b.world.match.score, [1, 0]);
    assert.equal(goalsA, 1, 'client A saw exactly one goal');
    assert.equal(goalsB, 1, 'client B saw exactly one goal');
    a.leave(); b.leave();
  } finally { await srv.close(); }
});

test('clients cannot award goals, set boost, or override physics', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const { a, b, rec } = await privateMatch(srv);
    await run([a, b], 3600);
    const host = rec.host;
    const before = JSON.stringify(host.world.match.score);
    // a cheating client on its own socket: try every kind of forged state
    const pa = a.conn.ws;
    const forged = [
      { t: 'goal', team: 0 }, { t: 'score', v: [9, 0] }, { t: 'snap', s: [1, [], [], [], []] },
      { t: 'boost', v: 100 }, { t: 'state', pos: [0, 0, 0] }, { t: 'in', s: 1, i: [[9999, 0, 0, 0, 0, 0]] },
      { t: 'in', s: -5, i: [[0, 0, 0, 0, 0, 0]] }, { t: 'in', s: 10, i: [[0, 0, 0, 0, 0, 64]] },
    ];
    for (const f of forged) pa.send(JSON.stringify(f));
    // tamper with the local copy too: the next snapshot must restore authoritative values
    const meLocal = a.world.car(a.pid);
    meLocal.boost = 100; a.world.match.score = [5, 5];
    await run([a, b], 400);
    assert.equal(JSON.stringify(host.world.match.score), before, 'authority unchanged');
    assert.equal(JSON.stringify(a.world.match.score), before, 'client corrected by snapshot');
    const authBoost = host.world.car(a.pid).boost;
    assert.ok(Math.abs(a.world.car(a.pid).boost - authBoost) < 2, `boost restored (${a.world.car(a.pid).boost} vs ${authBoost})`);
    const p = host.players.get(a.pid);
    assert.ok(p.violations >= 3, 'invalid packets were counted: ' + p.violations);
    a.leave(); b.leave();
  } finally { await srv.close(); }
});

test('boost pads cannot be double-collected by exploiting latency', async () => {
  const srv = await startServer({ port: 0, quiet: true, lag: 120, jitter: 40 });
  try {
    const { a, b, rec } = await privateMatch(srv);
    await run([a, b], 3500);
    const w = rec.host.world;
    const pad = w.arena.pads.find((p) => p.large);
    const ia = w.arena.pads.indexOf(pad);
    // both cars parked on the same pad at the same moment on the authority
    for (const c of w.cars) { c.placeAt({ x: pad.x, y: 0.36, z: pad.z, isFinite: () => true }, 0); c.pos.set(pad.x, 0.36, pad.z); c.boost = 0; }
    await run([a, b], 1500);
    const got = w.cars.filter((c) => c.boost > 50).length;
    assert.equal(got, 1, 'exactly one car got the large pad');
    assert.ok(w.pads[ia] > 0 || got === 1);
    // clients converge on the authoritative outcome despite their own predictions
    for (const s of [a, b]) for (const c of w.cars) assert.ok(Math.abs(s.world.car(c.id).boost - c.boost) < 5, 'client boost matches authority');
    a.leave(); b.leave();
  } finally { await srv.close(); }
});

test('private matches reject invalid join codes', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    for (const code of ['ZZZZZZ', 'abc', '<script>', '']) {
      const r = rawSocket(srv.port, 'op=join&code=' + encodeURIComponent(code));
      await r.opened;
      r.send({ t: 'hello', name: 'x', cos: {}, v: 3 });
      await waitFor(() => r.isClosed());
      assert.equal(r.msgs[0]?.code, 'bad_code');
    }
  } finally { await srv.close(); }
});

test('malformed traffic is rejected and abusive connections are dropped', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    // anything other than a handshake first is refused
    const r0 = rawSocket(srv.port, 'op=create&mode=1v1');
    await r0.opened; r0.send({ t: 'in', s: 1, i: [[0, 0, 0, 0, 0, 0]] });
    await waitFor(() => r0.isClosed());
    assert.equal(r0.msgs[0]?.code, 'expected_hello');
    const r = rawSocket(srv.port, 'op=create&mode=1v1');
    await r.opened;
    r.send({ t: 'hello', name: 'Spam', cos: {}, v: 3 });
    await waitFor(() => r.msgs.some((m) => m.t === 'welcome'));
    r.send('not json');
    r.send({ t: 'nope' });
    r.send({ t: 'team', v: 7 });
    await sleep(150);
    assert.ok(!r.isClosed(), 'a few bad messages are tolerated');
    for (let i = 0; i < 80; i++) r.send('{garbage');
    await waitFor(() => r.isClosed(), 3000);
    // oversize message
    const r2 = rawSocket(srv.port, 'op=create&mode=1v1');
    await r2.opened;
    r2.send({ t: 'hello', name: 'Big', cos: {}, v: 3 });
    await waitFor(() => r2.msgs.some((m) => m.t === 'welcome'));
    r2.send({ t: 'chat', q: 1, pad: 'x'.repeat(9000) });
    await waitFor(() => r2.isClosed(), 3000);
    const st = await (await fetch(`http://127.0.0.1:${srv.port}/status`)).json();
    assert.ok(st.ok, 'server still healthy');
  } finally { await srv.close(); }
});

test('a disconnect does not crash the match; bot takes over; reconnect restores control; match ends', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const { a, b, rec } = await privateMatch(srv);
    const host = rec.host;
    await run([a, b], 3500);
    const bPid = b.pid, token = b.token;
    b.conn.ws.close();
    await run([a], 500);
    const pb = host.players.get(bPid);
    assert.equal(pb.connected, false);
    assert.equal(pb.queue.length, 0, 'no stale inputs kept');
    await run([a], 3200);
    assert.ok(pb.botCtl, 'bot drives the disconnected car');
    assert.equal(a.conn_[bPid], 3, 'clients are told a bot is driving');
    // reconnect with the token
    const b2 = connectClient(srv.port, 'op=join&code=' + a.code, 'Ben', token);
    await waitFor(() => b2.pid === bPid && b2.world && b2.snapCount > 2);
    assert.equal(pb.connected, true); assert.equal(pb.botCtl, null);
    // end the match early on the authority and make sure everyone gets results
    host.world.match.clock = 0.5;
    host.world.match.score = [2, 1];
    await waitFor(() => a.result && b2.result, 5000).catch(async () => { await run([a, b2], 3000); });
    await run([a, b2], 200);
    assert.ok(a.result && b2.result, 'both received results');
    assert.equal(a.result.winner, 0);
    assert.deepEqual(a.result.score, [2, 1]);
    a.leave(); b2.leave();
  } finally { await srv.close(); }
});

test('public matchmaking places players together and fills empty seats with bots', async () => {
  const srv = await startServer({ port: 0, quiet: true, lobbyTimeout: 2 });
  try {
    const a = connectClient(srv.port, 'op=queue&mode=2v2', 'Q1');
    await waitFor(() => a.lobby);
    const b = connectClient(srv.port, 'op=queue&mode=2v2', 'Q2');
    await waitFor(() => b.lobby);
    assert.equal(a.code, b.code, 'same lobby');
    assert.equal(a.lobby.priv, false);
    await run([a, b], 2600);
    await waitFor(() => a.world && b.world);
    const host = srv.sessions.get(a.code).host;
    assert.equal(host.players.size, 4, 'two humans + two bots');
    assert.equal([...host.players.values()].filter((p) => p.bot).length, 2);
    a.leave(); b.leave();
  } finally { await srv.close(); }
});

test('state stays consistent under simulated latency, jitter and loss', async () => {
  const srv = await startServer({ port: 0, quiet: true, lag: 150, jitter: 50, loss: 0.05 });
  try {
    const { a, b, rec } = await privateMatch(srv);
    await run([a, b], 3300);
    a.input.throttle = 1; a.input.steer = 0.4; b.input.throttle = 1; b.input.boost = true;
    await run([a, b], 3000, (c) => { c.input.jump = Math.random() < 0.05; });
    a.input = { ...a.input, throttle: 0, steer: 0, jump: false }; b.input = { ...b.input, throttle: 0, boost: false };
    await run([a, b], 2500);
    const w = rec.host.world;
    for (const s of [a, b]) {
      for (const c of w.cars) {
        const mine = s.world.car(c.id);
        const d = mine.pos.dist(c.pos);
        // views are compared at one wall-clock instant, so a car still rolling (e.g. down a wall) is
        // legitimately up to one one-way latency of travel apart
        const tol = 1.5 + c.vel.len() * 0.25;
        assert.ok(d < tol, `client view of car ${c.id} within ${tol.toFixed(2)} m of authority (got ${d.toFixed(3)}, speed ${c.vel.len().toFixed(1)})`);
      }
      assert.ok(s.rtt > 100, 'latency measured: ' + s.rtt);
    }
    a.leave(); b.leave();
  } finally { await srv.close(); }
});
