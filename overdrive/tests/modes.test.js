import test from 'node:test';
import assert from 'node:assert/strict';
import { World, quantizeInput } from '../shared/world.js';
import { Bot } from '../shared/bot.js';
import { Arena } from '../shared/arena.js';
import { ARENA_VARIANTS, HOOPS, arenasForMode } from '../shared/config.js';
import { setQuiet } from '../shared/log.js';

setQuiet(true);
const params = (id) => ARENA_VARIANTS[id].params;

function liveWorld(id) {
  const w = new World({ seed: 3, duration: 120, arenaParams: params(id) });
  w.addCar(1, 0); w.addCar(2, 1);
  w.startMatch();
  for (let i = 0; i < 120 * 6 && w.match.state !== 'live'; i++) w.step();
  assert.equal(w.match.state, 'live');
  return w;
}
function runUntilGoal(w, sec) {
  for (let i = 0; i < 120 * sec; i++) {
    w.step();
    const g = w.events.find((e) => e.type === 'goal');
    w.events.length = 0;
    if (g) return g;
  }
  return null;
}
function parkCars(w) { for (const c of w.cars) { c.pos.set(c.team ? 20 : -20, 0.6, 0); c.vel.set(0, 0, 0); } }

test('every mode has maps, and soccar has no ramps beside the goals', () => {
  for (const m of ['soccar', 'hoops', 'dropshot']) assert.ok(arenasForMode(m).length >= 1, m);
  assert.ok(arenasForMode('soccar').length >= 5);
  const a = new Arena(params('stadium'));
  // standing on the floor right beside a goal post, the floor is still flat (distance to surface = height)
  const x = a.goalHalfW + 3;
  for (const z of [a.halfL - 4, a.halfL - 3]) assert.ok(Math.abs(a.interior(x, 1, z) - 1) < 0.05, `flat at z=${z}`);
});

test('hoops: ball dropped through the rim scores, ball resting on the rim does not', () => {
  const w = liveWorld('court');
  const a = w.arena;
  parkCars(w);
  w.ball.pos.set(0, a.rimY + 3, a.hoopZ); w.ball.vel.set(0, -2, 0); w.ball.angVel.set(0, 0, 0);
  const g = runUntilGoal(w, 3);
  assert.ok(g, 'goal scored');
  assert.equal(g.team, 0, 'blue scores in the orange hoop');
  assert.deepEqual(w.match.score, [1, 0]);

  const w2 = liveWorld('court');
  parkCars(w2);
  // ball coming down onto the front of the rim bounces off it
  w2.ball.pos.set(0, w2.arena.rimY + 3, w2.arena.hoopZ - HOOPS.rimRadius - 0.6); w2.ball.vel.set(0, -3, 0);
  let minZ = Infinity, maxY = -Infinity, bounced = false;
  for (let i = 0; i < 120; i++) { w2.step(); w2.events.length = 0; if (w2.ball.vel.y > 1) bounced = true; maxY = Math.max(maxY, w2.ball.pos.y); minZ = Math.min(minZ, w2.ball.pos.z); }
  assert.ok(bounced, 'rim is solid');
  assert.deepEqual(w2.match.score, [0, 0]);
});

test('dropshot: charged ball damages tiles, then opens a hole the ball falls through', () => {
  const w = liveWorld('hexcore');
  const a = w.arena;
  parkCars(w);
  assert.ok(a.tiles.length > 60, 'tile count ' + a.tiles.length);
  assert.equal(a.pads.length, 0, 'no boost pads in dropshot');
  const drop = (x, z) => {
    w.drop.active = true; w.drop.team = 0; w.drop.level = 1; w.drop.charge = 0;
    w.ball.pos.set(x, 6, z); w.ball.vel.set(0, -6, 0); w.ball.angVel.set(0, 0, 0);
    for (let i = 0; i < 120 && w.drop.active; i++) { w.step(); w.events.length = 0; }
  };
  const tx = 0, tz = 20;
  const i = a.tileAt(tx, tz);
  assert.ok(i >= 0 && a.tiles[i].team === 1);
  drop(tx, tz);
  assert.equal(w.tiles[i], 1, 'first hit damages');
  assert.deepEqual(w.match.score, [0, 0]);
  drop(tx, tz);
  assert.equal(w.tiles[i], 2, 'second hit opens');
  // the ball is now over an open tile: it falls through and blue scores
  w.ball.pos.set(a.tiles[i].x, 3, a.tiles[i].z); w.ball.vel.set(0, -1, 0);
  const g = runUntilGoal(w, 3);
  assert.ok(g, 'ball fell through');
  assert.equal(g.team, 0);
  // kickoff restores the floor
  for (let k = 0; k < 120 * 8 && w.match.state !== 'live'; k++) w.step();
  assert.equal(w.tiles[i], 0);
});

test('dropshot: own-side landings and the level-3 radius', () => {
  const w = liveWorld('hexcore');
  const a = w.arena;
  parkCars(w);
  const i = a.tileAt(0, -20);
  w.drop.active = true; w.drop.team = 0; w.drop.level = 1;
  w.ball.pos.set(0, 5, -20); w.ball.vel.set(0, -6, 0);
  for (let k = 0; k < 120; k++) { w.step(); w.events.length = 0; }
  assert.equal(w.tiles[i], 0, 'own floor is never damaged');
  const j = a.tileAt(0, 24);
  w.drop.active = true; w.drop.team = 0; w.drop.level = 3;
  w.ball.pos.set(a.tiles[j].x, 5, a.tiles[j].z); w.ball.vel.set(0, -6, 0);
  for (let k = 0; k < 120 && w.drop.active; k++) { w.step(); w.events.length = 0; }
  const hit = [...w.tiles].filter((s) => s > 0).length;
  assert.ok(hit >= 15, 'level 3 damages a wide area: ' + hit);
});

for (const id of ['court', 'hexcore']) {
  test(`bots play ${id} matches to the end`, () => {
    const w = new World({ seed: 5, duration: 90, arenaParams: params(id) });
    const bots = [];
    for (let i = 0; i < 4; i++) { w.addCar(i + 1, i % 2); bots.push(new Bot(i + 1, 'pro', 9 + i)); }
    w.startMatch();
    let t = 0, touches = 0;
    while (w.match.state !== 'ended' && t < 120 * 700) {
      for (const b of bots) w.setInput(b.id, quantizeInput(b.think(w)));
      w.step(); t++;
      for (const e of w.events) if (e.type === 'touch') touches++;
      w.events.length = 0;
      for (const c of w.cars) assert.ok(c.pos.isFinite());
      assert.ok(w.ball.pos.isFinite());
    }
    assert.equal(w.match.state, 'ended');
    assert.ok(touches > 20, 'touches ' + touches);
    assert.ok(w.match.score[0] + w.match.score[1] > 0, 'someone scored');
  });
}

test('assists count from the scorer\'s touch, not from the goal', () => {
  const w = new World({ seed: 1, duration: 120 });
  w.addCar(1, 0); w.addCar(2, 0); w.addCar(3, 1);
  w.startMatch();
  for (let i = 0; i < 120 * 6 && w.match.state !== 'live'; i++) w.step();
  const [a, b] = [w.car(1), w.car(2)];
  for (const c of w.cars) { c.pos.set(c.id * 8 - 16, 0.4, -20); c.vel.set(0, 0, 0); }
  w.onTouch(a, 6);                       // pass
  for (let i = 0; i < 120 * 3; i++) w.tick++;
  w.onTouch(b, 9);                       // shot
  for (let i = 0; i < 120 * 4; i++) w.tick++; // slow roller: goal 4 s after the shot, 7 s after the pass
  w.ball.pos.set(0, 1.9, w.arena.halfL + 3); w.ball.vel.set(0, 0, 5);
  w.step();
  assert.deepEqual(w.match.score, [1, 0]);
  assert.equal(w.stats.get(2).goals, 1);
  assert.equal(w.stats.get(1).assists, 1);
});
