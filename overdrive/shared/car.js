// Vehicle simulation: ground driving, wall driving, jumps, dodges, air control, boost.
// Tuned for responsiveness and a high skill ceiling rather than road-car realism.
// All parameters live in config.js (CAR). Units: metres, seconds, kg, radians.

import { CAR, PHYSICS } from './config.js';
import { V3, Quat, clamp } from './math.js';

export const BTN_JUMP = 1, BTN_BOOST = 2, BTN_SLIDE = 4;

export function neutralInput() {
  return { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false };
}

// Sanitise an input object coming from anywhere (network, bots, devices).
export function sanitizeInput(i, out = neutralInput()) {
  const f = (v) => (Number.isFinite(v) ? clamp(v, -1, 1) : 0);
  out.throttle = f(i.throttle); out.steer = f(i.steer); out.pitch = f(i.pitch);
  out.yaw = f(i.yaw); out.roll = f(i.roll);
  out.jump = !!i.jump; out.boost = !!i.boost; out.slide = !!i.slide;
  return out;
}

// Inertia (kg m^2) of the hitbox about the car's local axes
const INERTIA = (() => {
  const m = CAR.mass, w = CAR.half.x * 2, h = CAR.half.y * 2, l = CAR.half.z * 2;
  return { left: (m / 12) * (l * l + h * h), up: (m / 12) * (l * l + w * w), fwd: (m / 12) * (w * w + h * h) };
})();

const _t1 = new V3(), _t2 = new V3(), _n = new V3();

export class Car {
  constructor(id, team) {
    this.id = id;
    this.team = team;
    this.pos = new V3();
    this.vel = new V3();
    this.rot = new Quat();
    this.angVel = new V3();
    this.boost = 33.3;
    // derived each step
    this.fwd = new V3(0, 0, 1); this.up = new V3(0, 1, 0); this.left = new V3(1, 0, 0);
    // state machine for jumps / dodges
    this.onGround = false;
    this.groundNormal = new V3(0, 1, 0);
    this.jumped = false;       // first jump used since last wheel contact
    this.jumping = false;      // in the jump-hold phase
    this.jumpClock = 0;        // seconds since first jump started
    this.doubleJumped = false; // second jump or dodge consumed
    this.dodgeTime = 0;        // remaining flip time
    this.boostTime = 0;        // seconds boost has been active (min boost duration)
    this.boosting = false;
    this.prevButtons = 0;
    this.jumpBuffer = 0;
    this.lastKickTick = -1000;
    this.frozen = false;
    this.airTime = 0;
    this.input = neutralInput(); // last applied input (replicated for prediction of others)
    this.updateAxes();
  }

  updateAxes() {
    this.fwd.set(0, 0, 1).applyQuat(this.rot);
    this.up.set(0, 1, 0).applyQuat(this.rot);
    this.left.set(1, 0, 0).applyQuat(this.rot);
  }

  // world-space inverse inertia applied to v
  invInertia(v, out) {
    const l = v.dot(this.left) / INERTIA.left, u = v.dot(this.up) / INERTIA.up, f = v.dot(this.fwd) / INERTIA.fwd;
    return out.set(
      this.left.x * l + this.up.x * u + this.fwd.x * f,
      this.left.y * l + this.up.y * u + this.fwd.y * f,
      this.left.z * l + this.up.z * u + this.fwd.z * f,
    );
  }

  hitboxCenter(out) {
    const o = CAR.hitboxOffset;
    return out.copy(this.pos).addScaled(this.left, o.x).addScaled(this.up, o.y).addScaled(this.fwd, o.z);
  }

  placeAt(pos, yaw) {
    this.pos.copy(pos);
    this.rot.setAxisAngle(_t1.set(0, 1, 0), yaw);
    this.vel.set(0, 0, 0); this.angVel.set(0, 0, 0);
    this.onGround = true; this.groundNormal.set(0, 1, 0);
    this.jumped = false; this.jumping = false; this.doubleJumped = false; this.dodgeTime = 0;
    this.jumpClock = 0; this.boosting = false; this.boostTime = 0; this.jumpBuffer = 0; this.airTime = 0;
    this.updateAxes();
  }
}

function throttleAccel(speed) {
  // decreasing acceleration curve; throttle alone tops out at throttleTopSpeed
  const top = CAR.throttleTopSpeed;
  if (speed >= top) return 0;
  if (speed > top - 0.1) return 1.6 * (top - speed) / 0.1;
  return CAR.throttleAccel * (1 - 0.9 * speed / (top - 0.1));
}

function steerCurvature(speed) {
  // curvature (1/m) falls off with speed: tight turns slow, wide turns fast
  const t = clamp(Math.abs(speed) / CAR.maxSpeed, 0, 1);
  const k = 1 - Math.pow(1 - t, 2.2); // ease
  return CAR.steerCurvatureLow + (CAR.steerCurvatureHigh - CAR.steerCurvatureLow) * k;
}

// Apply controls and forces for one fixed step. Integration and collisions happen in world.js.
export function stepCarControls(car, inp, arena, dt, events) {
  car.updateAxes();
  const buttons = (inp.jump ? BTN_JUMP : 0) | (inp.boost ? BTN_BOOST : 0) | (inp.slide ? BTN_SLIDE : 0);
  const jumpPressed = inp.jump && !(car.prevButtons & BTN_JUMP);
  car.prevButtons = buttons;
  car.input = inp;

  if (car.frozen) {
    car.vel.set(0, 0, 0); car.angVel.set(0, 0, 0);
    car.boosting = false;
    return;
  }

  const { fwd, up, left, vel, angVel } = car;
  const g = PHYSICS.gravity;

  // ---------- surface detection (wheels) ----------
  const p = car.pos;
  const s = arena.interior(p.x, p.y, p.z);
  const n = arena.normal(p.x, p.y, p.z, _n);
  const upDotN = up.dot(n);
  const ignoreGround = car.jumping && car.jumpClock < 0.08;
  const wheelsTouch = !ignoreGround && s < CAR.restHeight + CAR.groundProbe && upDotN > 0.55;
  const wasGround = car.onGround;
  car.onGround = wheelsTouch;
  if (wheelsTouch) car.groundNormal.copy(n);

  if (jumpPressed) car.jumpBuffer = CAR.jumpBuffer;
  else if (car.jumpBuffer > 0) car.jumpBuffer -= dt;

  // ---------- boost (ground and air) ----------
  const wantBoost = inp.boost && car.boost > 0;
  if (wantBoost || (car.boosting && car.boostTime < CAR.boostMinTime && car.boost > 0)) {
    if (!car.boosting && events) events.push({ type: 'boostOn', car: car.id });
    car.boosting = true;
    car.boostTime += dt;
    car.boost = Math.max(0, car.boost - CAR.boostUsePerSec * dt);
    vel.addScaled(fwd, CAR.boostAccel * dt);
  } else {
    if (car.boosting && events) events.push({ type: 'boostOff', car: car.id, empty: car.boost <= 0 });
    car.boosting = false; car.boostTime = 0;
  }

  if (wheelsTouch) {
    if (!wasGround) {
      if (events && car.airTime > 0.25) events.push({ type: 'land', car: car.id, speed: -vel.dot(n) });
      car.jumped = false; car.doubleJumped = false; car.dodgeTime = 0; car.jumping = false;
    }
    car.airTime = 0;
    // ----- suspension: hold ride height along the surface normal -----
    const vn = vel.dot(n);
    const disp = CAR.restHeight - s;
    let acc = CAR.suspensionK * disp - CAR.suspensionC * vn;
    if (acc < -40) acc = -40;
    vel.addScaled(n, acc * dt);

    // ----- longitudinal drive -----
    const vf = vel.dot(fwd);
    const t = inp.throttle;
    let dv = 0;
    if (Math.abs(t) > 0.01) {
      if (Math.sign(t) !== Math.sign(vf) && Math.abs(vf) > 0.3) {
        dv = Math.sign(t) * CAR.brakeAccel * dt; // braking
        if (Math.abs(dv) > Math.abs(vf)) dv = -vf;
      } else if (t > 0) {
        dv = throttleAccel(Math.max(0, vf)) * t * dt;
      } else {
        const rs = Math.max(0, -vf);
        dv = rs < CAR.reverseTopSpeed ? -CAR.throttleAccel * (1 - 0.9 * rs / CAR.reverseTopSpeed) * -t * dt : 0;
      }
    } else if (!car.boosting) {
      const c = CAR.coastDecel * dt;
      dv = Math.abs(vf) < c ? -vf : -Math.sign(vf) * c;
    }
    vel.addScaled(fwd, dv);

    // ----- lateral grip / powerslide -----
    const vl = vel.dot(left);
    const grip = (inp.slide ? CAR.driftGrip : CAR.grip) * dt;
    const corr = Math.abs(vl) < grip ? -vl : -Math.sign(vl) * grip;
    vel.addScaled(left, corr);

    // ----- steering: yaw rate about the surface normal -----
    const vf2 = vel.dot(fwd);
    let target = -inp.steer * steerCurvature(vf2) * vf2 * (inp.slide ? CAR.driftSteerBoost : 1);
    const wy = angVel.dot(n);
    const yawRate = wy + (target - wy) * Math.min(1, CAR.steerResponse * dt);
    // ----- align chassis to the surface -----
    _t1.crossVectors(up, n); // rotation axis taking up -> n
    angVel.copy(n).scale(yawRate).addScaled(_t1, CAR.alignRate);

    // ----- stick to surfaces (lose traction on steep walls when slow) -----
    const speed = vel.len();
    if (!(n.y < 0.3 && speed < CAR.minWallSpeed)) vel.addScaled(n, -CAR.stickyAccel * dt);

    // ----- jump -----
    if (jumpPressed || car.jumpBuffer > 0) {
      car.jumpBuffer = 0;
      vel.addScaled(up, CAR.jumpImpulse);
      car.jumped = true; car.jumping = true; car.jumpClock = 0; car.onGround = false;
      if (events) events.push({ type: 'jump', car: car.id });
    }
  } else {
    car.airTime += dt;
    // ---------- jump hold ----------
    if (car.jumped) car.jumpClock += dt;
    if (car.jumping) {
      if (inp.jump && car.jumpClock < CAR.jumpHoldTime) vel.addScaled(up, CAR.jumpHoldAccel * dt);
      else if (car.jumpClock >= CAR.jumpMinTime) car.jumping = false;
    }

    // ---------- second jump / dodge ----------
    const canSecond = !car.doubleJumped && !car.jumping &&
      (!car.jumped || car.jumpClock < CAR.jumpHoldTime + CAR.doubleJumpWindow);
    if (jumpPressed && canSecond) {
      const fIn = inp.pitch, sIn = inp.steer;
      const mag = Math.max(Math.abs(fIn), Math.abs(sIn));
      if (mag >= CAR.dodgeDeadzone) {
        // directional dodge relative to the car's local axes
        let f = fIn, sd = sIn;
        const l = Math.hypot(f, sd); if (l > 1) { f /= l; sd /= l; }
        const upright = up.y > 0.5;
        const df = _t1.copy(fwd), dr = _t2.copy(left).scale(-1);
        if (upright) { df.y = 0; df.norm(); dr.y = 0; dr.norm(); }
        const speedFrac = clamp(vel.len() / CAR.maxSpeed, 0, 1);
        const fImp = f >= 0 ? f * CAR.dodgeImpulseForward : f * CAR.dodgeImpulseBackward;
        const sImp = sd * CAR.dodgeImpulseSide * (1 + CAR.dodgeSideSpeedScale * speedFrac);
        if (CAR.dodgeVerticalCancel && upright) vel.y = vel.y < 0 ? 0 : vel.y * 0.65;
        vel.addScaled(df, fImp).addScaled(dr, sImp);
        // flip spin: forward input -> nose down (about -right = +left); right input -> roll right (about +fwd)
        angVel.copy(left).scale(f * CAR.dodgeSpin).addScaled(fwd, sd * CAR.dodgeSpin);
        car.dodgeTime = CAR.dodgeDuration;
        if (events) events.push({ type: 'dodge', car: car.id, f, s: sd });
      } else {
        vel.addScaled(up, CAR.doubleJumpImpulse);
        if (events) events.push({ type: 'jump', car: car.id, second: true });
      }
      car.doubleJumped = true;
      car.jumped = true;
    } else if (jumpPressed && s < 0.9 && upDotN <= 0.55) {
      // ---------- recovery: car resting on roof / side ----------
      vel.addScaled(n, CAR.recoverImpulse);
      _t1.crossVectors(up, n);
      if (_t1.lenSq() < 1e-4) _t1.copy(fwd);
      _t1.norm();
      angVel.addScaled(_t1, CAR.recoverTorque * 0.5);
      if (events) events.push({ type: 'jump', car: car.id, recover: true });
    }

    // ---------- air control ----------
    let pitch = inp.pitch, yaw = inp.yaw, roll = inp.roll;
    if (inp.slide) { roll = clamp(roll + yaw, -1, 1); yaw = 0; } // air-roll modifier
    if (car.dodgeTime > 0) {
      car.dodgeTime -= dt;
      // during the flip, only yaw/roll trims are allowed; pitch is owned by the flip
      angVel.addScaled(up, -yaw * CAR.airYawAccel * 0.25 * dt);
    } else {
      // pitch input +1 (W) = nose down. Nose down is rotation about +left.
      angVel.addScaled(left, pitch * CAR.airPitchAccel * dt);
      angVel.addScaled(up, -yaw * CAR.airYawAccel * dt);
      angVel.addScaled(fwd, roll * CAR.airRollAccel * dt);
      // damping per local axis (pitch/yaw damping fades while the stick is held)
      const wp = angVel.dot(left), wyw = angVel.dot(up), wr = angVel.dot(fwd);
      angVel.addScaled(left, -wp * CAR.airPitchDamp * (1 - Math.abs(pitch)) * dt);
      angVel.addScaled(up, -wyw * CAR.airYawDamp * (1 - Math.abs(yaw)) * dt);
      angVel.addScaled(fwd, -wr * CAR.airRollDamp * (1 - Math.abs(roll)) * dt);
      angVel.clampLen(CAR.maxAngularSpeed);
    }
    if (Math.abs(inp.throttle) > 0.01) vel.addScaled(fwd, CAR.airThrottleAccel * inp.throttle * dt);
  }

  vel.y -= g * dt;
  vel.clampLen(CAR.maxSpeed);
}

export function integrateCar(car, dt) {
  if (car.frozen) return;
  car.pos.addScaled(car.vel, dt);
  car.rot.integrate(car.angVel, dt);
  car.updateAxes();
}

export { INERTIA };
