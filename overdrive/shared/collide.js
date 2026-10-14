// Collision resolution: car vs arena, car vs ball, car vs car.

import { CAR, BALL } from './config.js';
import { V3, clamp } from './math.js';

const _c = new V3(), _p = new V3(), _n = new V3(), _r = new V3(), _v = new V3(), _t = new V3(), _t2 = new V3();
const _bestN = new V3(), _bestP = new V3();
const HB_POINTS = (() => {
  const h = CAR.half, pts = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push([sx * h.x, sy * h.y, sz * h.z]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) pts.push([sx * h.x, sy * h.y, 0]);
  pts.push([0, h.y, h.z], [0, h.y, -h.z], [0, -h.y, h.z], [0, -h.y, -h.z]);
  return pts;
})();

function pointVel(car, r, out) { return out.crossVectors(car.angVel, r).add(car.vel); }

// Apply an impulse J (vector) at offset r from the car's centre of mass.
function applyImpulse(car, r, J) {
  car.vel.addScaled(J, 1 / CAR.mass);
  _t2.crossVectors(r, J);
  car.invInertia(_t2, _t2);
  car.angVel.add(_t2);
}

// Returns the strongest normal impact speed (for audio) or 0.
export function collideCarArena(car, arena) {
  if (car.frozen) return 0;
  car.hitboxCenter(_c);
  let deepest = 0, impact = 0;
  for (let i = 0; i < HB_POINTS.length; i++) {
    const q = HB_POINTS[i];
    _p.copy(_c).addScaled(car.left, q[0]).addScaled(car.up, q[1]).addScaled(car.fwd, q[2]);
    const s = arena.interior(_p.x, _p.y, _p.z);
    if (s >= 0) continue;
    arena.normal(_p.x, _p.y, _p.z, _n);
    if (-s > deepest) { deepest = -s; _bestN.copy(_n); _bestP.copy(_p); }
    _r.subVectors(_p, car.pos);
    pointVel(car, _r, _v);
    const vn = _v.dot(_n);
    if (vn >= 0) continue;
    impact = Math.max(impact, -vn);
    // normal impulse with rigid-body effective mass
    _t.crossVectors(_r, _n); car.invInertia(_t, _t); _t.crossVectors(_t, _r);
    const k = 1 / CAR.mass + _n.dot(_t);
    const e = -vn > 2 ? CAR.wallRestitution : 0;
    const jn = -(1 + e) * vn / k;
    _t.copy(_n).scale(jn);
    applyImpulse(car, _r, _t);
    // friction
    pointVel(car, _r, _v);
    _v.reject(_n);
    const vt = _v.len();
    if (vt > 1e-4) {
      const jt = Math.min(vt / k, CAR.wallFriction * jn);
      _t.copy(_v).scale(-jt / vt);
      applyImpulse(car, _r, _t);
    }
  }
  if (deepest > 0) car.pos.addScaled(_bestN, Math.min(deepest, 0.5));
  return impact;
}

const _lc = new V3(), _closest = new V3(), _dir = new V3(), _rc = new V3(), _rb = new V3(), _vrel = new V3();

// Returns true if the car touched the ball this step.
export function collideCarBall(car, ball, tick, dt) {
  if (car.frozen) return false;
  car.hitboxCenter(_c);
  // ball centre in hitbox space
  _t.subVectors(ball.pos, _c);
  const lx = _t.dot(car.left), ly = _t.dot(car.up), lz = _t.dot(car.fwd);
  const h = CAR.half;
  const cx = clamp(lx, -h.x, h.x), cy = clamp(ly, -h.y, h.y), cz = clamp(lz, -h.z, h.z);
  _closest.copy(_c).addScaled(car.left, cx).addScaled(car.up, cy).addScaled(car.fwd, cz);
  _n.subVectors(ball.pos, _closest);
  let d = _n.len();
  const R = ball.radius;
  if (d >= R) return false;
  if (d < 1e-5) {
    // ball centre inside the hitbox: push out along the car's up axis
    _n.copy(car.up); d = 0;
  } else _n.scale(1 / d);
  const pen = R - d;
  const mb = ball.mass, mc = CAR.mass, tot = mb + mc;
  ball.pos.addScaled(_n, pen * (mc / tot));
  car.pos.addScaled(_n, -pen * (mb / tot));

  // relative velocity at the contact
  _rc.subVectors(_closest, car.pos);
  _rb.copy(_n).scale(-R);
  pointVel(car, _rc, _v);
  _vrel.crossVectors(ball.angVel, _rb).add(ball.vel).sub(_v);
  const relSpeed = Math.min(_vrel.len(), BALL.hitMaxRelSpeed);
  const vn = _vrel.dot(_n);
  if (vn < 0) {
    _t.crossVectors(_rc, _n); car.invInertia(_t, _t); _t.crossVectors(_t, _rc);
    const k = 1 / mb + 1 / mc + _n.dot(_t);
    const jn = -vn / k;
    ball.vel.addScaled(_n, jn / mb);
    _t.copy(_n).scale(-jn);
    applyImpulse(car, _rc, _t);
    // friction -> ball spin
    _vrel.reject(_n);
    const vt = _vrel.len();
    if (vt > 1e-4) {
      const jt = Math.min(vt / (3.5 / mb + 1 / mc), 2 * jn);
      _vrel.scale(1 / vt);
      ball.vel.addScaled(_vrel, -jt / mb);
      _t.crossVectors(_rb, _vrel).scale(-jt / ball.inertia);
      ball.angVel.add(_t);
    }
  }
  // Extra "hit" impulse shaping: depends on relative speed and where the ball sits relative to the car.
  if ((tick - car.lastKickTick) * dt >= BALL.hitCooldown) {
    car.lastKickTick = tick;
    _dir.subVectors(ball.pos, car.pos);
    _dir.y *= BALL.hitVertical;
    _dir.addScaled(car.fwd, -_dir.dot(car.fwd) * BALL.hitForwardBias);
    _dir.norm();
    const t = relSpeed / BALL.hitMaxRelSpeed;
    const scale = BALL.hitScaleLow + (BALL.hitScaleHigh - BALL.hitScaleLow) * t;
    ball.vel.addScaled(_dir, relSpeed * scale);
  }
  return true;
}

const _pa = new V3(), _pb = new V3();
// Simple car-car bumps using two proxy spheres per car. Returns impact speed or 0.
export function collideCars(a, b) {
  if (a.frozen || b.frozen) return 0;
  const R = CAR.bumpRadius;
  let best = null, bestD = 2 * R;
  for (const oa of CAR.bumpSpheres) {
    _pa.copy(a.pos).addScaled(a.fwd, oa);
    for (const ob of CAR.bumpSpheres) {
      _pb.copy(b.pos).addScaled(b.fwd, ob);
      const d = _pa.dist(_pb);
      if (d < bestD) { bestD = d; best = [oa, ob]; }
    }
  }
  if (!best) return 0;
  _pa.copy(a.pos).addScaled(a.fwd, best[0]);
  _pb.copy(b.pos).addScaled(b.fwd, best[1]);
  _n.subVectors(_pb, _pa);
  if (bestD < 1e-5) _n.set(0, 1, 0); else _n.scale(1 / bestD);
  const pen = 2 * R - bestD;
  a.pos.addScaled(_n, -pen / 2); b.pos.addScaled(_n, pen / 2);
  _v.subVectors(b.vel, a.vel);
  const vn = _v.dot(_n);
  if (vn >= 0) return 0;
  const e = CAR.carCarRestitution;
  const j = -(1 + e) * vn / 2; // equal masses, linear only
  a.vel.addScaled(_n, -j); b.vel.addScaled(_n, j);
  // bump: the car that was hit gets shoved a bit more, with a little lift
  const closing = -vn;
  if (closing > 4) {
    const bumpTarget = a.vel.dot(_n) > -b.vel.dot(_n) ? b : a; // the car being driven into
    const dir = bumpTarget === b ? 1 : -1;
    bumpTarget.vel.addScaled(_n, dir * closing * 0.25);
    bumpTarget.vel.y += closing * 0.06;
  }
  return closing;
}
