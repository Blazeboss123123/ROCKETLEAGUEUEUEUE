// Ball physics: gravity, drag, spin, rebounds, rolling friction, and numerical safeguards.

import { BALL, PHYSICS } from './config.js';
import { V3 } from './math.js';

const _n = new V3(), _r = new V3(), _vc = new V3(), _vt = new V3(), _tmp = new V3();

export class Ball {
  constructor() {
    this.pos = new V3(0, BALL.radius, 0);
    this.vel = new V3();
    this.angVel = new V3();
    this.radius = BALL.radius;
    this.mass = BALL.mass;
    this.inertia = 0.4 * BALL.mass * BALL.radius * BALL.radius;
    this.stuckT = 0;
    this.onSurface = false;
  }
  reset(y = BALL.radius) {
    this.pos.set(0, y, 0); this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0); this.stuckT = 0;
  }
}

// Forces + integration for one step. Returns nothing; collisions are separate.
export function stepBallForces(ball, dt) {
  ball.vel.y -= PHYSICS.gravity * dt;
  ball.vel.scale(1 - BALL.drag * dt);
}

export function integrateBall(ball, dt) {
  ball.vel.clampLen(BALL.maxSpeed);
  ball.angVel.clampLen(BALL.maxAngularSpeed);
  ball.pos.addScaled(ball.vel, dt);
}

// Collide against the arena SDF. Returns impact speed (normal) if a bounce happened, else 0.
export function collideBallArena(ball, arena, dt) {
  const R = ball.radius;
  const p = ball.pos;
  const s = arena.interior(p.x, p.y, p.z);
  ball.onSurface = false;
  if (s >= R + 0.02) return 0;
  const n = arena.normal(p.x, p.y, p.z, _n);
  ball.onSurface = true;
  if (s < R) p.addScaled(n, R - s); // positional correction
  const vn = ball.vel.dot(n);
  if (vn >= 0) return 0;
  const e = vn > -0.6 ? 0 : BALL.restitution; // no micro-bounces while rolling
  const jn = -(1 + e) * vn * ball.mass;     // normal impulse magnitude
  ball.vel.addScaled(n, -(1 + e) * vn);
  // contact-point velocity for friction / spin coupling
  _r.copy(n).scale(-R);
  _vc.crossVectors(ball.angVel, _r).add(ball.vel);
  _vt.copy(_vc).reject(n);
  const vtLen = _vt.len();
  if (vtLen > 1e-5) {
    const kt = ball.mass / 3.5; // effective tangential mass of a solid sphere
    const J = Math.min(vtLen * kt, BALL.friction * jn);
    _vt.scale(1 / vtLen);
    ball.vel.addScaled(_vt, -J / ball.mass);
    _tmp.crossVectors(_r, _vt).scale(-J / ball.inertia);
    ball.angVel.add(_tmp);
  }
  // rolling resistance
  if (e === 0) {
    const tv = _vt.copy(ball.vel).reject(n);
    const tl = tv.len();
    const d = BALL.rollingDecel * dt;
    if (tl > d) ball.vel.addScaled(tv, -d / tl); else ball.vel.sub(tv);
  }
  return -vn;
}

// Ball-only prediction (no cars) used by bots and by shot/save detection.
// Writes up to `steps` samples into out[] as {t, x, y, z, vx, vy, vz}.
export function predictBall(ball, arena, seconds, step, out) {
  const sim = predictBall._b || (predictBall._b = new Ball());
  sim.pos.copy(ball.pos); sim.vel.copy(ball.vel); sim.angVel.copy(ball.angVel);
  const n = Math.floor(seconds / step);
  out.length = 0;
  for (let i = 1; i <= n; i++) {
    stepBallForces(sim, step);
    integrateBall(sim, step);
    collideBallArena(sim, arena, step);
    out.push({ t: i * step, x: sim.pos.x, y: sim.pos.y, z: sim.pos.z, vx: sim.vel.x, vy: sim.vel.y, vz: sim.vel.z });
  }
  return out;
}

// Which goal (team that would concede) the ball is heading into within `seconds`, or -1.
const _pred = [];
export function ballHeading(ball, arena, seconds = 2.5) {
  predictBall(ball, arena, seconds, 1 / 40, _pred);
  const tmp = predictBall._tmp || (predictBall._tmp = new V3());
  for (const s of _pred) {
    tmp.set(s.x, s.y, s.z);
    const g = arena.goalConceded(tmp, ball.radius);
    if (g >= 0) return g;
  }
  return -1;
}
