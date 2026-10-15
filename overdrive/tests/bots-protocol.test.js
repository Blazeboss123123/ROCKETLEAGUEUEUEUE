import test from 'node:test';
import assert from 'node:assert/strict';
import { World, quantizeInput, packInput, unpackInput } from '../shared/world.js';
import { Bot } from '../shared/bot.js';
import { MatchHost } from '../shared/host.js';
import { validateClientMsg, cleanName, sanitizeCosmetics, CODE_RE, makeCode } from '../shared/protocol.js';
import { setQuiet } from '../shared/log.js';

setQuiet(true);

function botMatch(levelBlue, levelOrange, seed, duration = 120, size = 2) {
  const w = new World({ seed, duration });
  const bots = [];
  for (let i = 0; i < size * 2; i++) { w.addCar(i + 1, i % 2); bots.push(new Bot(i + 1, i % 2 ? levelOrange : levelBlue, seed + i)); }
  w.startMatch();
  let ticks = 0, touches = 0, jumps = 0, aerials = 0;
  while (w.match.state !== 'ended' && ticks < 120 * (duration + 600)) {
    for (const b of bots) w.setInput(b.id, quantizeInput(b.think(w)));
    w.step(); ticks++;
    for (const e of w.events) { if (e.type === 'touch') touches++; if (e.type === 'jump') jumps++; }
    for (const c of w.cars) if (!c.onGround && c.pos.y > 4 && c.boosting) aerials++;
    w.events.length = 0;
    for (const c of w.cars) assert.ok(c.pos.isFinite() && c.vel.isFinite(), 'finite state');
  }
  return { w, touches, jumps, aerials };
}

test('bots play complete matches: touch the ball, jump, collect boost, score', () => {
  const r = botMatch('pro', 'pro', 11, 120);
  assert.equal(r.w.match.state, 'ended');
  assert.ok(r.touches > 20, 'touches ' + r.touches);
  assert.ok(r.jumps > 10, 'jumps ' + r.jumps);
  const boost = [...r.w.stats.values()].reduce((a, s) => a + s.boost, 0);
  assert.ok(boost > 100, 'collected boost ' + boost);
});

test('difficulty matters: elite outscores rookie', () => {
  let elite = 0, rookie = 0, aerials = 0;
  for (const seed of [1, 2, 3, 4]) {
    const swap = seed % 2 === 0; // play both ends of the pitch
    const r = swap ? botMatch('rookie', 'elite', seed, 120, 1) : botMatch('elite', 'rookie', seed, 120, 1);
    elite += r.w.match.score[swap ? 1 : 0]; rookie += r.w.match.score[swap ? 0 : 1]; aerials += r.aerials;
  }
  assert.ok(elite > rookie, `elite ${elite} vs rookie ${rookie}`);
  assert.ok(aerials > 0, 'elite bots attempt aerials');
});

test('offline host runs a bot-filled match with no network', () => {
  const out = [];
  const h = new MatchHost({ mode: '3v3', kind: 'offline', isPrivate: true, fill: 'rookie', autoStart: true, duration: 20, out: (t, m) => out.push(m) });
  const r = h.join('Solo', {});
  assert.ok(r.pid);
  assert.equal(h.phase, 'match');
  assert.equal(h.players.size, 6);
  for (let i = 0; i < 120 * 10; i++) h.tick();
  assert.ok(out.some((m) => m.t === 'snap'), 'snapshots produced');
  h.world.match.clock = 0.2; h.world.match.score = [1, 0];
  for (let i = 0; i < 120 * 30 && h.phase === 'match'; i++) h.tick();
  assert.equal(h.phase, 'results');
  assert.ok(out.some((m) => m.t === 'end'));
});

test('protocol validation rejects malformed or out-of-range messages', () => {
  assert.equal(validateClientMsg(null), null);
  assert.equal(validateClientMsg({ t: 'in', s: 1, i: [[101, 0, 0, 0, 0, 0]] }), null);
  assert.equal(validateClientMsg({ t: 'in', s: 1, i: [[0, 0, 0, 0, 0, 8]] }), null);
  assert.equal(validateClientMsg({ t: 'in', s: 1.5, i: [[0, 0, 0, 0, 0, 0]] }), null);
  assert.equal(validateClientMsg({ t: 'in', s: 1, i: new Array(40).fill([0, 0, 0, 0, 0, 0]) }), null);
  assert.ok(validateClientMsg({ t: 'in', s: 1, i: [[100, -100, 0, 0, 0, 7]] }));
  assert.equal(validateClientMsg({ t: 'team', v: 2 }), null);
  assert.equal(validateClientMsg({ t: 'chat', q: 99 }), null);
  assert.equal(validateClientMsg({ t: 'goal' }), null);
  assert.equal(cleanName('<img src=x onerror=alert(1)>'), 'img srcx onerror');
  assert.equal(cleanName(''), 'Player');
  assert.deepEqual(sanitizeCosmetics({ body: 'comet', paint: 0xff0000, evil: 'x', trail: '<script>' }), { body: 'comet', paint: 0xff0000 });
  for (let i = 0; i < 50; i++) assert.ok(CODE_RE.test(makeCode()));
});

test('input quantisation round-trips exactly', () => {
  const i = { throttle: 0.333, steer: -1, pitch: 0.5, yaw: -0.25, roll: 1, jump: true, boost: false, slide: true };
  const q = quantizeInput(i);
  assert.deepEqual(unpackInput(packInput(q)), q);
  assert.equal(q.throttle, 0.33);
});
