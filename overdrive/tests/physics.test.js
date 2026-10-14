// Physics and match-rule tests.  Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/world.js';
import { neutralInput } from '../shared/car.js';
import { V3 } from '../shared/math.js';
import { CAR, BOOST_PADS, MATCH, PHYSICS, BALL } from '../shared/config.js';
import { setQuiet } from '../shared/log.js';
import { TrainingSession } from '../client/training.js';

setQuiet(true);
const inp = (o = {}) => ({ ...neutralInput(), ...o });

function freeWorld(opts = {}) {
  const w = new World({ free: true, ...opts });
  w.match.state = 'free';
  w.ballHidden = false;
  w.ball.pos.set(0, BALL.radius, 30); // keep the ball out of the way
  return w;
}
function carAt(w, x = 0, z = -20, yaw = 0, id = 1, team = 0) {
  const c = w.addCar(id, team);
  c.placeAt(new V3(x, CAR.restHeight, z), yaw);
  return c;
}
function run(w, seconds, input, id = 1) {
  const n = Math.round(seconds / PHYSICS.dt);
  for (let i = 0; i < n; i++) { if (input) w.setInput(id, typeof input === 'function' ? input(i) : input); w.step(); }
}

test('a stationary car remains stable', () => {
  const w = freeWorld(); const c = carAt(w);
  run(w, 3, inp());
  assert.ok(c.onGround, 'grounded');
  assert.ok(c.vel.len() < 0.01, 'not drifting: ' + c.vel.len());
  assert.ok(Math.abs(c.pos.x) < 0.01 && Math.abs(c.pos.z + 20) < 0.01, 'stayed put');
  assert.ok(c.up.y > 0.999, 'level');
});

test('acceleration is consistent and capped by the throttle curve', () => {
  const speeds = [];
  for (let k = 0; k < 2; k++) { const w = freeWorld(); const c = carAt(w); run(w, 1, inp({ throttle: 1 })); speeds.push(c.vel.len()); }
  assert.equal(speeds[0], speeds[1], 'deterministic');
  assert.ok(speeds[0] > 8 && speeds[0] < 14.1, 'speed after 1 s: ' + speeds[0]);
  const w = freeWorld(); const c = carAt(w, 0, -40); run(w, 4, inp({ throttle: 1 }));
  assert.ok(c.vel.len() <= CAR.throttleTopSpeed + 0.05, 'throttle cap');
});

test('reverse movement works', () => {
  const w = freeWorld(); const c = carAt(w, 0, 0); run(w, 1, inp({ throttle: -1 }));
  assert.ok(c.vel.dot(c.fwd) < -5, 'moving backwards');
  assert.ok(c.pos.z < -2, 'moved towards -z');
});

test('steering changes direction correctly (right turns right)', () => {
  for (const [steer, sign] of [[1, -1], [-1, 1]]) {
    const w = freeWorld(); const c = carAt(w, 0, -20, 0);
    run(w, 0.6, inp({ throttle: 1 }));
    run(w, 0.25, inp({ throttle: 1, steer }));
    // facing +z initially; right is -x
    assert.ok(c.fwd.x * sign > 0.15, `steer ${steer} turned the right way: fwd.x=${c.fwd.x}`);
    assert.ok(c.pos.x * sign > 0, 'path curves the same way');
  }
});

test('jump and double jump', () => {
  const w = freeWorld(); const c = carAt(w, 0, -20);
  run(w, 0.5, inp());
  let max = 0;
  for (let i = 0; i < 240; i++) { w.setInput(1, inp({ jump: i < 24 })); w.step(); max = Math.max(max, c.pos.y); }
  assert.ok(max > 1.6, 'single jump height ' + max);
  run(w, 2, inp());
  let max2 = 0;
  for (let i = 0; i < 360; i++) { w.setInput(1, inp({ jump: i < 24 || (i > 36 && i < 40) })); w.step(); max2 = Math.max(max2, c.pos.y); }
  assert.ok(max2 > max + 1, `double jump ${max2} > single ${max}`);
  run(w, 2, inp());
  assert.ok(c.onGround && !c.jumped && !c.doubleJumped, 'grounded reset restores jumps');
});

function dodge(pitch, steer) {
  const w = freeWorld(); const c = carAt(w, 0, -20, 0);
  run(w, 0.5, inp());
  for (let i = 0; i < 6; i++) { w.setInput(1, inp({ jump: true })); w.step(); }
  for (let i = 0; i < 6; i++) { w.setInput(1, inp()); w.step(); }
  const v0 = c.vel.clone();
  w.setInput(1, inp({ jump: true, pitch, steer, yaw: steer })); w.step();
  return { dv: new V3().subVectors(c.vel, v0), c, w };
}

test('dodge directions follow the stick relative to the car', () => {
  const f = dodge(1, 0); assert.ok(f.dv.z > 4, 'front flip pushes forward ' + f.dv.z);
  const b = dodge(-1, 0); assert.ok(b.dv.z < -4, 'back flip pushes backward ' + b.dv.z);
  const r = dodge(0, 1); assert.ok(r.dv.x < -4, 'right dodge pushes right (-x) ' + r.dv.x);
  const l = dodge(0, -1); assert.ok(l.dv.x > 4, 'left dodge pushes left (+x) ' + l.dv.x);
  const d = dodge(0.7, 0.7); assert.ok(d.dv.z > 2 && d.dv.x < -2, 'diagonal');
  // flip consumes the second jump
  assert.ok(f.c.doubleJumped);
  const w = f.w, c = f.c; const v = c.vel.clone();
  for (let i = 0; i < 4; i++) { w.setInput(1, inp({ jump: i % 2 === 0, pitch: 1 })); w.step(); }
  assert.ok(c.vel.z - v.z < 1, 'no second dodge before landing');
});

test('boost consumes the resource at the configured rate', () => {
  const w = freeWorld(); const c = carAt(w, 0, -45); c.boost = 100;
  const noPads = () => w.pads.fill(999);
  noPads();
  run(w, 1, inp({ boost: true }));
  assert.ok(Math.abs(c.boost - (100 - CAR.boostUsePerSec)) < 0.6, 'boost after 1 s: ' + c.boost);
  noPads(); run(w, 3, () => (noPads(), inp({ boost: true })));
  assert.equal(c.boost, 0);
  const v = c.vel.len(); run(w, 0.5, inp({ boost: true }));
  assert.ok(c.vel.len() <= v + 0.01, 'no thrust without boost');
});

test('small and large pads restore the configured amounts, then respawn', () => {
  const w = freeWorld();
  const small = w.arena.pads.find((p) => !p.large), large = w.arena.pads.find((p) => p.large);
  const c = carAt(w, small.x, small.z); c.boost = 10;
  w.step();
  assert.equal(c.boost, 10 + BOOST_PADS.small.amount);
  const i = w.arena.pads.indexOf(small);
  assert.ok(w.pads[i] > 0, 'small pad depleted');
  c.boost = 10; w.step(); assert.equal(c.boost, 10, 'cannot collect a depleted pad');
  c.boost = 100; run(w, BOOST_PADS.small.respawn + 0.1, inp()); assert.equal(w.pads[i], 0, 'respawned');
  c.placeAt(new V3(large.x, CAR.restHeight, large.z), 0); c.boost = 5; w.step();
  assert.equal(c.boost, 100);
});

test('only one car can take a pad on the same tick', () => {
  const w = freeWorld();
  const pad = w.arena.pads.find((p) => p.large);
  const a = carAt(w, pad.x - 0.5, pad.z, 0, 1, 0), b = carAt(w, pad.x + 0.5, pad.z, 0, 2, 1);
  a.boost = 0; b.boost = 0;
  w.step();
  assert.equal((a.boost > 0 ? 1 : 0) + (b.boost > 0 ? 1 : 0), 1);
});

test('the ball rebounds from walls', () => {
  const w = freeWorld();
  w.ball.pos.set(25, 5, 0); w.ball.vel.set(20, 0, 0);
  run(w, 1.2);
  assert.ok(w.ball.vel.x < -5, 'bounced back: ' + w.ball.vel.x);
  assert.ok(w.ball.pos.x < w.arena.halfW, 'inside arena');
});

test('the ball interacts with cars (speed-dependent hits)', () => {
  const hit = (speed) => {
    const w = freeWorld(); const c = carAt(w, 0, -10);
    w.ball.pos.set(0, BALL.radius, -6); w.ball.vel.set(0, 0, 0);
    c.vel.copy(c.fwd).scale(speed);
    let touched = false;
    for (let i = 0; i < 120; i++) { w.setInput(1, inp({ throttle: 1 })); w.step(); if (w.events.some((e) => e.type === 'touch')) touched = true; w.events.length = 0; if (touched) break; }
    run(w, 0.05, inp());
    return { touched, v: w.ball.vel.len(), vz: w.ball.vel.z };
  };
  const slow = hit(5), fast = hit(20);
  assert.ok(slow.touched && fast.touched);
  assert.ok(fast.vz > slow.vz + 5, `faster car hits harder ${fast.vz} vs ${slow.vz}`);
});

test('goals: ball can enter each goal; partial crossing is not a goal', () => {
  for (const [z, conceded] of [[1, 1], [-1, 0]]) {
    const w = new World({ seed: 1 });
    w.addCar(1, 0); w.addCar(2, 1);
    w.startMatch();
    run(w, MATCH.countdown + 0.1);
    assert.equal(w.match.state, 'live');
    const a = w.arena;
    // partially across the line: no goal
    w.ball.pos.set(0, 2, z * (a.halfL + BALL.radius * 0.5)); w.ball.vel.set(0, 0, 0);
    w.checkGoal();
    assert.equal(w.match.state, 'live', 'partial crossing');
    // fully across
    w.ball.pos.set(0, 2, z * (a.halfL - 3)); w.ball.vel.set(0, 0, z * 15);
    run(w, 1);
    assert.equal(w.match.state, 'goal');
    assert.equal(w.match.score[1 - conceded], 1, 'correct team credited');
    assert.equal(w.match.score[conceded], 0);
    // goal counted once
    run(w, 1);
    assert.equal(w.match.score[1 - conceded], 1);
  }
});

test('kickoff resets players and the ball', () => {
  const w = new World({ seed: 7 });
  for (let i = 0; i < 6; i++) w.addCar(i + 1, i % 2);
  w.startMatch();
  const spawns = w.cars.map((c) => c.pos.clone());
  run(w, MATCH.countdown + 0.1);
  for (const c of w.cars) w.setInput(c.id, inp({ throttle: 1 }));
  run(w, 2);
  w.ball.pos.set(0, 2, w.arena.halfL - 2); w.ball.vel.set(0, 0, 20);
  run(w, MATCH.goalPause + 1.5);
  assert.equal(w.match.state, 'countdown');
  for (const c of w.cars) assert.ok(Math.abs(c.pos.y - CAR.restHeight) < 0.01 && c.frozen && c.vel.len() === 0, 'car reset');
  assert.ok(w.ball.pos.x === 0 && w.ball.pos.z === 0 && w.ball.vel.len() === 0, 'ball reset');
  // kickoff spawns are mirror-symmetric between teams
  const blue = w.cars.filter((c) => c.team === 0).map((c) => [c.pos.x, c.pos.z]).sort();
  const orange = w.cars.filter((c) => c.team === 1).map((c) => [-c.pos.x, -c.pos.z]).sort();
  assert.deepEqual(blue, orange);
  void spawns;
});

test('match time expires and overtime resolves with sudden death', () => {
  const w = new World({ seed: 3, duration: 5 });
  w.addCar(1, 0); w.addCar(2, 1);
  w.startMatch();
  run(w, MATCH.countdown + 5.5);
  // tied at 0:00 -> overtime once the ball is on the ground (it is)
  assert.equal(w.match.overtime, true);
  assert.equal(w.match.state, 'countdown');
  run(w, MATCH.countdown + 1);
  assert.equal(w.match.state, 'live');
  w.ball.pos.set(0, 2, -w.arena.halfL + 2); w.ball.vel.set(0, 0, -20);
  run(w, MATCH.goalPause + 1);
  assert.equal(w.match.state, 'ended');
  assert.deepEqual(w.match.score, [0, 1]);
  assert.equal(w.winner(), 1);
});

test('regulation ends with a winner when not tied', () => {
  const w = new World({ seed: 3, duration: 4 });
  w.addCar(1, 0); w.addCar(2, 1);
  w.startMatch(); run(w, MATCH.countdown + 0.5);
  w.ball.pos.set(0, 2, w.arena.halfL - 2); w.ball.vel.set(0, 0, 20);
  run(w, MATCH.goalPause + MATCH.countdown + 6);
  assert.equal(w.match.state, 'ended');
  assert.equal(w.winner(), 0);
});

test('invalid states recover safely', () => {
  const w = freeWorld(); const c = carAt(w);
  w.ball.pos.set(NaN, 3, 0);
  c.vel.set(Infinity, 0, 0);
  w.step();
  assert.ok(w.ball.pos.isFinite() && w.arena.interior(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z) > 0, 'ball reset inside');
  assert.ok(c.pos.isFinite() && c.vel.isFinite(), 'car respawned');
  w.ball.pos.set(0, -50, 0); w.step();
  assert.ok(w.ball.pos.y > 0, 'ball below world reset');
});

test('cars drive up walls and stay attached at speed', () => {
  const w = freeWorld(); const c = carAt(w, 20, 0, Math.PI / 2); // facing +x towards the side wall
  let maxY = 0, onWall = false;
  for (let i = 0; i < 240; i++) { w.setInput(1, inp({ throttle: 1, boost: true })); w.step(); maxY = Math.max(maxY, c.pos.y); if (c.onGround && c.up.y < 0.3) onWall = true; }
  assert.ok(onWall, 'drove onto the wall');
  assert.ok(maxY > 4, 'climbed: ' + maxY);
});

test('simulation is frame-rate independent (fixed step)', () => {
  const run2 = (dt) => {
    const t = new TrainingSession('free');
    const ctl = { throttle: 1, steer: 0.3, pitch: 0, yaw: 0.3, roll: 0, jump: false, boost: true, slide: false };
    let time = 0; while (time < 2) { t.update(dt, ctl); time += dt; }
    while (t.world.tick < 240) t.update(1 / 1000, ctl);
    return [t.world.tick, t.car.pos.x, t.car.pos.z];
  };
  const a = run2(1 / 30), b = run2(1 / 144);
  assert.equal(a[0], b[0]);
  assert.ok(Math.abs(a[1] - b[1]) < 1e-9 && Math.abs(a[2] - b[2]) < 1e-9, `same result ${a} ${b}`);
});

test('ball never tunnels through the arena at max speed', () => {
  const w = freeWorld();
  for (const dir of [[1, 0, 0], [0, 0, 1], [0.7, 0.7, 0], [0, 1, 0], [-0.6, -0.8, 0]]) {
    w.ball.pos.set(0, 6, 5); w.ball.vel.set(dir[0] * 60, dir[1] * 60, dir[2] * 60);
    for (let i = 0; i < 240; i++) { w.step(); assert.ok(w.arena.interior(w.ball.pos.x, w.ball.pos.y, w.ball.pos.z) > 0, 'inside'); }
    w.ballHidden = false;
  }
});

test('a front flip completes one rotation, lands on its wheels and gains speed', () => {
  const w = freeWorld(); const c = carAt(w, 0, -40);
  run(w, 1, inp({ throttle: 1 }));
  const before = c.vel.len();
  run(w, 4 / 120, inp({ throttle: 1, jump: true })); run(w, 6 / 120, inp({ throttle: 1 }));
  run(w, 1 / 120, inp({ throttle: 1, jump: true, pitch: 1 }));
  let landed = null;
  for (let i = 0; i < 240 && !landed; i++) { w.setInput(1, inp({ throttle: 1 })); w.step(); if (c.onGround && i > 20) landed = { up: c.up.y, speed: c.vel.len() }; }
  assert.ok(landed, 'landed');
  assert.ok(landed.up > 0.95, 'wheels down: up.y=' + landed.up);
  assert.ok(landed.speed > before + 4.5, `flip added speed: ${before.toFixed(2)} -> ${landed.speed.toFixed(2)}`);
  run(w, 1, inp({ throttle: 1 }));
  assert.ok(c.vel.len() > CAR.throttleTopSpeed + 1, 'flip speed is kept above the throttle cap');
});

test('a flip can be cancelled by pulling back', () => {
  const w = freeWorld(); const c = carAt(w, 0, -40);
  run(w, 0.3, inp());
  for (let i = 0; i < 24; i++) { w.setInput(1, inp({ jump: true })); w.step(); }
  run(w, 4 / 120, inp());
  w.setInput(1, inp({ jump: true, pitch: 1 })); w.step();
  run(w, 0.1, inp({ pitch: -1 }));
  assert.equal(c.dodgeTime, 0, 'flip rotation stopped');
  assert.ok(Math.abs(c.angVel.dot(c.left)) < 3, 'no full-speed pitch spin');
});

test('supersonic hits demolish opponents (not teammates) and they respawn', () => {
  for (const team of [1, 0]) {
    const w = freeWorld();
    const a = carAt(w, 0, -30, 0, 1, 0), b = carAt(w, 0, -22, Math.PI / 2, 2, team);
    a.vel.set(0, 0, 22.5); a.boost = 100;
    let demo = null;
    for (let i = 0; i < 90; i++) { w.setInput(1, inp({ throttle: 1, boost: true })); w.step(); for (const e of w.events) if (e.type === 'demo') demo = e; w.events.length = 0; }
    if (team === 0) { assert.equal(demo, null, 'no friendly demolitions'); continue; }
    assert.ok(demo && demo.victim === 2 && demo.attacker === 1, 'opponent demolished');
    assert.ok(b.demoT > 0, 'victim out of play');
    run(w, CAR.respawnTime + 0.2, inp());
    assert.equal(b.demoT, 0, 'respawned');
    assert.ok(b.pos.z > 30, 'respawned at its own (orange, +z) end: ' + b.pos.z);
  }
  // slow bumps never demolish
  const w = freeWorld();
  const a = carAt(w, 0, -30, 0, 1, 0), b = carAt(w, 0, -27, Math.PI / 2, 2, 1);
  a.vel.set(0, 0, 12);
  let demo = false;
  for (let i = 0; i < 60; i++) { w.setInput(1, inp({ throttle: 1 })); w.step(); if (w.events.some((e) => e.type === 'demo')) demo = true; w.events.length = 0; }
  assert.equal(demo, false);
});
