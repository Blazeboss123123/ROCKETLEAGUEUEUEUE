// Bot controller: rotation-based team play with ball prediction, intercepts, boost management,
// jumps, dodges, aerials (higher difficulties) and air recovery.
// A bot only produces an input object; it has no privileged access to physics.

import { BOTS, CAR } from './config.js';
import { V3, clamp, rng } from './math.js';
import { neutralInput } from './car.js';
import { predictBall } from './ball.js';

const _d = new V3(), _tgt = new V3(), _aim = new V3(), _tmp = new V3();

// Shared per-tick ball prediction cache
function prediction(world) {
  if (world._predTick !== world.tick) {
    world._predTick = world.tick;
    world._pred = world._pred || [];
    if (world.ballHidden) world._pred.length = 0;
    else predictBall(world.ball, world.arena, 3.5, 1 / 30, world._pred);
  }
  return world._pred;
}

// Solve for an aerial intercept: the first predicted ball sample the car can reach with boost.
// Returns {target, t, dir (unit boost direction), accel (required boost accel)} or null.
const _sv = new V3(), _sd = new V3();
function aerialSolve(world, car, pred, fromGround) {
  const A = 9.9, g = 6.5;
  const vy0 = fromGround ? 5.8 : 0; // jump + hold adds roughly this much vertical speed
  for (const s of pred) {
    const t = s.t;
    if (t < 0.15) continue;
    if (s.y < 2.5) continue;
    // displacement still to cover after coasting with current velocity under gravity
    _sd.set(s.x - car.pos.x - car.vel.x * t, s.y - car.pos.y - (car.vel.y + vy0) * t + 0.5 * g * t * t, s.z - car.pos.z - car.vel.z * t);
    const need = (2 * _sd.len()) / (t * t);
    if (need <= A * 0.95) {
      _sv.set(s.x, s.y, s.z);
      const dir = _sd.clone().norm();
      return { target: _sv.clone(), t, dir, accel: need };
    }
  }
  return null;
}

export class Bot {
  constructor(id, difficulty = 'pro', seed = 1) {
    this.id = id;
    this.level = BOTS[difficulty] ? difficulty : 'pro';
    this.cfg = BOTS[this.level];
    this.rand = rng(seed * 31 + id * 977);
    this.input = neutralInput();
    this.plan = null;
    this.nextThink = 0;
    this.action = null; // scripted multi-tick action (jump/dodge/aerial)
    this.actionT = 0;
    this.noise = 0;
  }

  think(world) {
    const car = world.car(this.id);
    const inp = this.input;
    Object.assign(inp, neutralInput());
    if (!car || car.frozen) return inp;
    const m = world.match;
    if (m.state === 'ended' || m.state === 'waiting') return inp;
    const dt = world.dt;
    const t = world.tick * dt;

    // continue scripted actions first
    if (this.action) { this.runAction(world, car, inp, dt); if (this.action) return inp; }

    if (t >= this.nextThink || !this.plan) {
      this.nextThink = t + this.cfg.reaction * (0.7 + 0.6 * this.rand());
      this.noise = (this.rand() - 0.5) * 2 * this.cfg.aimNoise;
      this.plan = this.decide(world, car);
    }
    const plan = this.plan;
    if (!car.onGround) { this.airRecover(car, inp, plan); return inp; }
    this.drive(world, car, plan, inp);
    return inp;
  }

  // ---------------- decision making ----------------
  decide(world, car) {
    const ball = world.ball, arena = world.arena;
    const team = car.team, dir = team === 0 ? 1 : -1; // attacking direction along z
    const ownGoalZ = team === 0 ? -arena.halfL : arena.halfL;
    const pred = prediction(world);
    if (world.ballHidden) return { kind: 'position', x: 0, z: ownGoalZ * 0.5, speed: 0.6 };

    // kickoff: closest player goes, others hang back
    const mates = world.cars.filter((c) => c.team === team);
    const kickoff = world.match.state === 'live' && ball.vel.lenSq() < 0.01 && Math.abs(ball.pos.x) < 0.1 && Math.abs(ball.pos.z) < 0.1;
    const ranked = mates.map((c) => ({ c, cost: this.challengeCost(c, ball, dir, kickoff) })).sort((a, b) => a.cost - b.cost || a.c.id - b.c.id);
    const role = ranked.findIndex((r) => r.c === car);

    if (kickoff) {
      if (role === 0) return { kind: 'ball', x: 0, y: ball.radius, z: 0, kickoff: true, speed: 1 };
      if (role === 1 && this.cfg.boostUse > 0.5) return this.boostPlan(world, car, dir, true) || { kind: 'position', x: 0, z: ownGoalZ * 0.55, speed: 0.8 };
      return { kind: 'position', x: 0, z: ownGoalZ + dir * 6, speed: 0.7 };
    }

    if (role === 0) {
      // goal-side check: are we between the ball and our own goal?
      const ahead = (car.pos.z - ball.pos.z) * dir; // >0: car is between the ball and the opponent goal
      const threat = this.threatened(pred, arena, team);
      if (ahead > 4 && !threat) {
        // out of position: rotate back goal-side via the far post before challenging
        const x = clamp(ball.pos.x * 0.5 - Math.sign(ball.pos.x || 1) * 6, -arena.halfW + 6, arena.halfW - 6);
        const z = clamp(ball.pos.z - dir * 8, -arena.halfL + 3, arena.halfL - 3);
        return { kind: 'position', x, z, speed: 1, boostOk: true };
      }
      const icpt = this.intercept(world, car, pred, dir, threat);
      if (icpt) return icpt;
      return { kind: 'position', x: ball.pos.x, z: ball.pos.z - dir * 3, speed: 1 };
    }
    if (role === 1) {
      if (car.boost < 35 * this.cfg.boostUse + 5) { const bp = this.boostPlan(world, car, dir, false); if (bp) return bp; }
      const z = clamp(ball.pos.z - dir * 20, -arena.halfL + 6, arena.halfL - 6);
      return { kind: 'position', x: ball.pos.x * 0.45, z, speed: 0.85, face: true };
    }
    // last back: goalkeeper, shading toward the ball side
    return { kind: 'position', x: clamp(ball.pos.x * 0.25, -5, 5), z: ownGoalZ + dir * 3.5, speed: 0.9, face: true };
  }

  challengeCost(c, ball, dir, kickoff) {
    const d = c.pos.dist(ball.pos);
    if (kickoff) return d + (c.id % 7) * 0.01;
    const goalSide = (ball.pos.z - c.pos.z) * dir > 0 ? 0 : 12;
    _d.subVectors(ball.pos, c.pos).norm();
    const facing = (1 - c.fwd.dot(_d)) * 4;
    return d / 15 * 10 + goalSide + facing;
  }

  threatened(pred, arena, team) {
    for (let i = 0; i < pred.length; i += 2) {
      const s = pred[i];
      if (Math.abs(s.x) < arena.goalHalfW + 1 && s.y < arena.p.goalHeight + 0.5) {
        if (team === 0 ? s.z < -arena.halfL + 1 : s.z > arena.halfL - 1) return true;
      }
    }
    return false;
  }

  intercept(world, car, pred, dir, threat) {
    const arena = world.arena;
    const oppGoalZ = dir * (arena.halfL + 3);
    const ownGoalZ = -dir * arena.halfL;
    const avgSpeed = (car.boost > 15 && this.cfg.boostUse > 0.3 ? 17 : 12) * this.cfg.speedFactor;
    for (let i = 0; i < pred.length; i++) {
      const s = pred[i];
      const height = s.y;
      const aerial = height > 3.4;
      if (aerial && (!this.cfg.aerial || height > this.cfg.maxAerialHeight || car.boost < 25)) continue;
      if (!aerial && height > this.cfg.maxAerialHeight + 1.6 && height > 2.2) continue;
      // aim: towards the opponent goal, or away from our goal when defending deep
      const deep = (s.z - ownGoalZ) * dir < arena.halfL * 0.45;
      if (threat || deep) _aim.set(s.x - 0, 0, s.z - ownGoalZ).norm();
      else _aim.set(clamp(-s.x, -arena.goalHalfW * 0.6, arena.goalHalfW * 0.6) + this.noise * 4, 0, oppGoalZ - s.z).norm();
      // approach point behind the ball along the aim line; the offset shrinks as the car closes in,
      // which curves the car around so it meets the ball facing the target
      const far = Math.hypot(s.x - car.pos.x, s.z - car.pos.z);
      const off = clamp(far * 0.32, world.ball.radius + 0.6, 7);
      const tx = s.x - _aim.x * off, tz = s.z - _aim.z * off;
      _d.set(tx - car.pos.x, 0, tz - car.pos.z);
      const dist = _d.len();
      _d.scale(1 / Math.max(dist, 1e-3));
      const turn = Math.acos(clamp(_d.x * car.fwd.x + _d.z * car.fwd.z, -1, 1));
      const need = dist / avgSpeed + turn * 0.35 + (aerial ? 0.6 + height * 0.06 : 0);
      if (need <= s.t || i === pred.length - 1) {
        return { kind: 'ball', x: tx, y: height, z: tz, bx: s.x, by: s.y, bz: s.z, t: s.t, aerial, speed: 1, aimX: _aim.x, aimZ: _aim.z };
      }
    }
    return null;
  }

  boostPlan(world, car, dir, kickoff) {
    const arena = world.arena, ball = world.ball;
    let best = null, bestScore = Infinity;
    arena.pads.forEach((p, i) => {
      if (world.pads[i] > 0.5) return;
      // stay goal-side: only pads behind the ball (or on our half at kickoff)
      if (!kickoff && (ball.pos.z - p.z) * dir < -2) return;
      const d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
      const score = d / (p.large ? 2.2 : 1);
      if (score < bestScore && d < 40) { bestScore = score; best = p; }
    });
    return best ? { kind: 'position', x: best.x, z: best.z, speed: 1, pad: true, boostOk: false } : null;
  }

  // ---------------- execution ----------------
  drive(world, car, plan, inp) {
    _tgt.set(plan.x, 0, plan.z);
    _d.subVectors(_tgt, car.pos);
    const fwdC = _d.dot(car.fwd), rightC = -_d.dot(car.left);
    const dist = Math.hypot(fwdC, rightC);
    const ang = Math.atan2(rightC, fwdC);
    const speed = car.vel.dot(car.fwd);
    inp.steer = clamp(ang * 3, -1, 1);
    inp.slide = Math.abs(ang) > 1.6 && speed > 6;

    if (plan.kind === 'position') {
      // arrive and stop, then face the ball
      const desired = Math.min(23, dist * 1.4) * plan.speed;
      if (dist < 2.5) {
        inp.throttle = clamp(-speed * 0.3, -1, 1);
        if (plan.face || dist < 1) {
          const ba = this.angleTo(car, world.ball.pos);
          if (Math.abs(ba) > 0.4) { inp.throttle = 0.6; inp.steer = clamp(ba * 3, -1, 1); }
        }
      } else {
        inp.throttle = Math.abs(ang) > 2.4 && dist < 8 ? -1 : clamp((desired - speed) * 0.5, -1, 1);
        if (Math.abs(ang) > 2.4 && dist < 8) inp.steer = -inp.steer;
      }
      inp.boost = plan.boostOk !== false && desired > 15 && Math.abs(ang) < 0.25 && speed < 21 && car.boost > 30 * (1 - this.cfg.boostUse) + 10;
      return;
    }
    // ball plan: in the last few metres, aim the car's nose at the contact point behind the ball
    const bp0 = world.ball.pos;
    const dB = Math.hypot(bp0.x - car.pos.x, bp0.z - car.pos.z);
    if (dB < 6 && plan.aimX !== undefined) {
      _tgt.set(bp0.x - plan.aimX * 0.9, 0, bp0.z - plan.aimZ * 0.9);
      _d.subVectors(_tgt, car.pos);
      const a2 = Math.atan2(-_d.dot(car.left), _d.dot(car.fwd));
      inp.steer = clamp(a2 * 3.5, -1, 1);
    }
    inp.throttle = 1;
    const timeLeft = plan.t ?? 0;
    inp.boost = car.boost > 0 && Math.abs(ang) < 0.3 && (plan.kickoff || dist > 10 || (timeLeft > 0 && dist / Math.max(speed, 1) > timeLeft)) && this.cfg.boostUse > this.rand() * 0.5;
    if (plan.kickoff && dist < 4.2 && this.cfg.dodge) { this.start('dodge', { f: 1, s: 0 }); return; }
    const bpos = world.ball.pos;
    const dBall = car.pos.dist(bpos);
    const heightAbove = bpos.y - car.pos.y;
    // aerial
    if (plan.aerial && this.cfg.aerial && car.onGround && Math.abs(ang) < 0.3) {
      const sol = aerialSolve(world, car, prediction(world), true);
      if (sol && sol.t < 2.4 && sol.t > 0.5 && car.boost > sol.t * 30 && Math.abs(this.angleTo(car, sol.target)) < 0.35) { this.start('aerial', {}); return; }
    }
    // jump for bouncing balls
    if (heightAbove > 1.2 && heightAbove < 3.6 && dBall < 3.5 + Math.max(0, speed) * 0.25) { this.start('jump', { hold: heightAbove > 2.2 }); return; }
    // lined up with the target: commit with a power dodge
    const ballAng = this.angleTo(car, bpos);
    if (this.cfg.dodge && heightAbove < 1.3 && dBall < 4.2 && speed > 6 && Math.abs(ballAng) < 0.3 && plan.aimX !== undefined) {
      _tmp.subVectors(bpos, car.pos); _tmp.y = 0; _tmp.norm();
      if (_tmp.x * plan.aimX + _tmp.z * plan.aimZ > 0.8) { this.start('dodge', { f: 1, s: clamp(-_tmp.dot(car.left) * 0.8, -1, 1) * 0.5 }); return; }
    }
    // power dodge into low balls
    if (this.cfg.dodge && heightAbove < 1.2 && dBall < 3.2 && speed > 7 && Math.abs(ang) < 0.35) {
      _tmp.subVectors(bpos, car.pos);
      const side = clamp(-_tmp.dot(car.left) * 0.6, -1, 1);
      this.start('dodge', { f: 1, s: side * 0.6 });
    }
  }

  angleTo(car, p) {
    _d.subVectors(p, car.pos);
    return Math.atan2(-_d.dot(car.left), _d.dot(car.fwd));
  }

  start(kind, data) { this.action = { kind, ...data }; this.actionT = 0; }

  runAction(world, car, inp, dt) {
    const a = this.action;
    this.actionT += dt;
    const t = this.actionT;
    inp.throttle = 1;
    if (a.kind === 'jump') {
      inp.jump = t < (a.hold ? 0.2 : 0.05);
      if (t > 0.9 || (t > 0.3 && car.onGround)) this.action = null;
    } else if (a.kind === 'dodge') {
      if (t < 0.06) inp.jump = true;
      else if (t < 0.12) inp.jump = false;
      else if (t < 0.16) { inp.jump = true; inp.pitch = a.f; inp.steer = a.s; inp.yaw = a.s; }
      else { inp.pitch = 0; }
      if (t > 1.0 || (t > 0.4 && car.onGround)) this.action = null;
    } else if (a.kind === 'aerial') {
      // phase 1: jump (+ second jump) with the nose pitched up
      if (t < 0.2) { inp.jump = true; inp.pitch = -1; }
      else if (t < 0.24) { inp.jump = false; inp.pitch = -0.4; }
      else if (t < 0.27) { inp.jump = true; inp.pitch = 0; inp.steer = 0; inp.yaw = 0; }
      const sol = aerialSolve(world, car, prediction(world));
      if (!sol) { if (t > 0.6) this.action = null; return; }
      if (t >= 0.27) {
        // point the nose along the required acceleration and boost when aligned
        _d.copy(sol.dir);
        const upC = _d.dot(car.up), rightC = -_d.dot(car.left), fwdC = _d.dot(car.fwd);
        const wp = car.angVel.dot(car.left), wy = -car.angVel.dot(car.up), wr = car.angVel.dot(car.fwd);
        inp.pitch = clamp(-upC * 6 - wp * 0.45, -1, 1);
        inp.yaw = clamp(rightC * 6 - wy * 0.45, -1, 1);
        inp.roll = clamp(-car.left.y * 1.5 - wr * 0.3, -1, 1);
        inp.boost = fwdC > 0.85 && sol.accel > 2 && car.boost > 0;
        inp.throttle = 1;
      }
      if (t > 3.2 || (t > 0.5 && car.onGround) || world.lastTouch?.id === car.id && world.tick - world.lastTouch.tick < 2) this.action = null;
    }
  }

  airRecover(car, inp, plan) {
    // land on wheels, nose roughly along travel direction
    const wp = car.angVel.dot(car.left), wr = car.angVel.dot(car.fwd);
    inp.pitch = clamp(car.fwd.y * 2.5 - wp * 0.3, -1, 1);
    inp.roll = clamp(-car.left.y * 2.5 - wr * 0.25, -1, 1);
    if (car.up.y < -0.4 && Math.abs(car.left.y) < 0.3) inp.roll = 1;
    inp.throttle = 1;
  }
}
