// World: the complete game simulation (cars, ball, boost pads, match rules, statistics).
// Runs identically on the dedicated server, on a browser host, in offline matches and in
// client-side prediction. One call to step() advances exactly one fixed tick.

import { PHYSICS, MATCH, BALL, CAR } from './config.js';
const _demoHits = [];
import { V3, Quat, rng, round } from './math.js';
import { Arena } from './arena.js';
import { Car, stepCarControls, integrateCar, neutralInput, BTN_JUMP, BTN_BOOST, BTN_SLIDE } from './car.js';
import { Ball, stepBallForces, integrateBall, collideBallArena, ballHeading } from './ball.js';
import { collideCarArena, collideCarBall, collideCars } from './collide.js';
import { log } from './log.js';

export const STATES = ['waiting', 'countdown', 'live', 'goal', 'ended', 'free'];
const SC = Object.fromEntries(STATES.map((s, i) => [s, i]));

export function newStats() {
  return { score: 0, goals: 0, assists: 0, saves: 0, shots: 0, touches: 0, boost: 0, demos: 0 };
}

export class World {
  constructor(opts = {}) {
    this.arena = opts.arena || new Arena(opts.arenaParams);
    this.dt = PHYSICS.dt;
    this.tick = 0;
    this.seed = opts.seed ?? 1;
    this.authoritative = opts.authoritative !== false; // false => client prediction (no stats/rules side effects)
    this.duration = opts.duration ?? MATCH.duration;
    this.startBoost = opts.startBoost ?? MATCH.startBoost;
    this.unlimitedBoost = !!opts.unlimitedBoost;
    this.cars = [];
    this.inputs = new Map();
    this.ball = new Ball();
    this.pads = this.arena.pads.map(() => 0); // respawn timers (0 = available)
    this.events = [];
    this.emitEvents = true;
    this.stats = new Map();
    this.match = {
      state: opts.free ? 'free' : 'waiting', timer: 0, clock: this.duration, overtime: false,
      score: [0, 0], kickoffs: 0, goalSeq: 0, lastGoal: null, waitingGround: false,
    };
    this.ballHidden = false;
    this.demoSeq = 0; this.lastDemo = null;
    this.lastTouch = null;   // {id, team, tick}
    this.touchHistory = [];  // recent touches for assists
    this.heading = -1;       // which goal the ball is currently threatening (authoritative only)
    this.pendingEval = null;
    this.headingTimer = 0;
  }

  // ---------------- roster ----------------
  addCar(id, team) {
    const car = new Car(id, team);
    car.boost = this.startBoost;
    this.cars.push(car);
    this.cars.sort((a, b) => a.team - b.team || a.id - b.id);
    this.inputs.set(id, neutralInput());
    if (!this.stats.has(id)) this.stats.set(id, newStats());
    // a car joining mid-match drops in at its own goal
    const spawn = this.arena.kickoffSpawns(team, 5, null)[4 % 5] || this.arena.kickoffSpawns(team, 1, null)[0];
    car.placeAt(spawn.pos, spawn.yaw);
    car.frozen = this.match.state === 'countdown';
    return car;
  }
  removeCar(id) {
    this.cars = this.cars.filter((c) => c.id !== id);
    this.inputs.delete(id);
  }
  car(id) { for (const c of this.cars) if (c.id === id) return c; return null; }
  setInput(id, input) { if (this.inputs.has(id)) this.inputs.set(id, input); }

  // ---------------- match flow ----------------
  startMatch() {
    this.match.score = [0, 0];
    this.match.clock = this.duration;
    this.match.overtime = false;
    for (const s of this.stats.values()) Object.assign(s, newStats());
    this.kickoff();
  }

  kickoff() {
    const m = this.match;
    m.kickoffs++;
    const r = rng(this.seed * 7919 + m.kickoffs * 104729);
    const pattern = r();
    for (const team of [0, 1]) {
      const teamCars = this.cars.filter((c) => c.team === team);
      const spawns = this.arena.kickoffSpawns(team, teamCars.length, () => pattern);
      teamCars.forEach((c, i) => {
        c.placeAt(spawns[i].pos, spawns[i].yaw);
        c.boost = this.startBoost;
        c.frozen = true;
      });
    }
    this.ball.reset();
    this.ballHidden = false;
    this.pads.fill(0);
    this.lastTouch = null; this.touchHistory = []; this.pendingEval = null; this.shotBy = -1;
    m.state = 'countdown';
    m.timer = MATCH.countdown;
    m.waitingGround = false;
    this.event({ type: 'countdown' });
  }

  event(e) { if (this.emitEvents) this.events.push(e); }

  // ---------------- simulation step ----------------
  step() {
    const dt = this.dt;
    const m = this.match;
    this.tick++;

    // match timers
    if (m.state === 'countdown') {
      m.timer -= dt;
      if (m.timer <= 0) {
        m.state = 'live'; m.timer = 0;
        for (const c of this.cars) c.frozen = false;
        this.event({ type: 'kickoff' });
      }
    } else if (m.state === 'goal') {
      m.timer -= dt;
      if (m.timer <= 0) {
        if (this.authoritative) {
          if (m.overtime || (m.clock <= 0 && m.score[0] !== m.score[1])) this.endMatch();
          else this.kickoff();
        }
      }
    } else if (m.state === 'live') {
      if (m.overtime) m.clock += dt;
      else {
        m.clock -= dt;
        if (m.clock <= 0) { m.clock = 0; m.waitingGround = true; }
      }
    }
    const frozenWorld = m.state === 'ended' || m.state === 'waiting';

    // ---- cars: controls + integration ----
    for (const car of this.cars) {
      if (frozenWorld) { car.frozen = true; }
      if (car.demoT > 0) {
        car.demoT -= dt;
        if (car.demoT <= 0) this.respawn(car);
        continue;
      }
      const inp = this.inputs.get(car.id) || neutralInput();
      stepCarControls(car, inp, this.arena, dt, this.emitEvents ? this.events : null);
      if (this.unlimitedBoost) car.boost = 100;
      integrateCar(car, dt);
    }
    // ---- ball ----
    const ball = this.ball;
    const ballActive = !this.ballHidden && m.state !== 'countdown' && !frozenWorld;
    if (ballActive) {
      stepBallForces(ball, dt);
      integrateBall(ball, dt);
    }
    // ---- collisions ----
    for (const car of this.cars) {
      if (car.demoT > 0) continue;
      const imp = collideCarArena(car, this.arena);
      if (imp > 4) this.event({ type: 'carWall', car: car.id, speed: imp });
    }
    for (let i = 0; i < this.cars.length; i++) {
      for (let j = i + 1; j < this.cars.length; j++) {
        const a = this.cars[i], b = this.cars[j];
        if (a.demoT > 0 || b.demoT > 0) continue;
        _demoHits.length = 0;
        const imp = collideCars(a, b, _demoHits);
        for (const hit of _demoHits) this.demolish(hit.victim, hit.attacker);
        if (!_demoHits.length && imp > 2) this.event({ type: 'bump', a: a.id, b: b.id, speed: imp });
      }
    }
    if (ballActive) {
      const bimp = collideBallArena(ball, this.arena, dt);
      if (bimp > 3) this.event({ type: 'ballWall', speed: bimp, x: ball.pos.x, y: ball.pos.y, z: ball.pos.z });
      // alternate the resolution order every tick so simultaneous challenges are fair to both teams
      const n = this.cars.length, rev = this.tick & 1;
      for (let k = 0; k < n; k++) {
        const car = this.cars[rev ? n - 1 - k : k];
        if (car.demoT > 0) continue;
        const before = ball.vel.len();
        if (collideCarBall(car, ball, this.tick, dt)) this.onTouch(car, Math.abs(ball.vel.len() - before));
      }
    }
    // ---- boost pads ----
    this.updatePads(dt);
    // ---- safety: invalid states recover ----
    this.sanitize();
    // ---- rules ----
    if (ballActive) this.checkGoal();
    if (this.authoritative) {
      if (this.pendingEval && this.tick > this.pendingEval.tick) this.evaluateTouch();
      if (m.state === 'live' && m.waitingGround && !m.overtime) {
        // regulation ends when the ball next touches the floor after 0:00
        m.waitT = (m.waitT || 0) + dt;
        if (ball.pos.y < ball.radius + 0.3 || ball.onSurface || m.waitT > 6) {
          m.waitT = 0;
          if (m.score[0] !== m.score[1]) this.endMatch();
          else { m.overtime = true; m.clock = 0; m.waitingGround = false; this.event({ type: 'overtime' }); this.kickoff(); }
        }
      }
      // ball threat tracking for save detection (cheap, a few times per second)
      if (ballActive && --this.headingTimer <= 0) {
        this.headingTimer = 12;
        this.heading = ballHeading(ball, this.arena, 2.0);
      }
    }
  }

  // Supersonic hit on an opponent: the victim explodes and respawns at its own end.
  demolish(victim, attacker) {
    if (victim.demoT > 0) return;
    victim.demoT = CAR.respawnTime;
    this.demoSeq = (this.demoSeq || 0) + 1;
    this.lastDemo = { victim: victim.id, attacker: attacker.id };
    victim.vel.set(0, 0, 0); victim.angVel.set(0, 0, 0);
    victim.boosting = false; victim.dodgeTime = 0;
    this.event({ type: 'demo', victim: victim.id, attacker: attacker.id, x: victim.pos.x, y: victim.pos.y, z: victim.pos.z });
    if (this.authoritative) { const st = this.stats.get(attacker.id); if (st) { st.demos++; st.score += 25; } }
  }

  respawn(car) {
    const spawns = this.arena.kickoffSpawns(car.team, 5, () => 0);
    const pick = [spawns[2], spawns[3], spawns[4]][(car.id + this.tick) % 3];
    car.placeAt(pick.pos, pick.yaw);
    car.boost = this.startBoost;
    car.frozen = this.match.state === 'countdown';
    this.event({ type: 'respawn', car: car.id });
  }

  updatePads(dt) {
    const pads = this.arena.pads;
    for (let i = 0; i < pads.length; i++) {
      if (this.pads[i] > 0) { this.pads[i] = Math.max(0, this.pads[i] - dt); continue; }
      const pad = pads[i];
      // deterministic, alternating order so ties do not always favour one team
      const n = this.cars.length, rev = (this.tick + i) & 1;
      for (let k = 0; k < n; k++) {
        const car = this.cars[rev ? n - 1 - k : k];
        if (car.frozen || car.demoT > 0 || car.boost >= 100) continue;
        const dx = car.pos.x - pad.x, dz = car.pos.z - pad.z;
        if (dx * dx + dz * dz > pad.radius * pad.radius || car.pos.y - pad.y > pad.height) continue;
        const before = car.boost;
        car.boost = Math.min(100, car.boost + pad.amount);
        this.pads[i] = pad.respawn;
        if (this.authoritative) { const st = this.stats.get(car.id); if (st) st.boost += car.boost - before; }
        this.event({ type: 'pickup', car: car.id, pad: i, large: pad.large });
        break; // depleted — nobody else can take it this tick
      }
    }
  }

  sanitize() {
    const ball = this.ball;
    if (!this.arena.inBounds(ball.pos) || !ball.vel.isFinite() || !ball.angVel.isFinite()) {
      log('physics', 'ball left the world or became invalid; resetting', { pos: [ball.pos.x, ball.pos.y, ball.pos.z] });
      ball.reset(6); ball.vel.set(0, 0, 0);
    }
    // stuck detection: almost motionless while off the floor and untouched
    if (!this.ballHidden && this.match.state === 'live') {
      const lt = this.lastTouch ? (this.tick - this.lastTouch.tick) * this.dt : 99;
      if (ball.vel.lenSq() < 0.09 && ball.pos.y > ball.radius + 0.4 && lt > 0.5) {
        ball.stuckT += this.dt;
        if (ball.stuckT > BALL.stuckTime) {
          log('physics', 'ball stuck; nudging towards centre');
          const n = this.arena.normal(ball.pos.x, ball.pos.y, ball.pos.z, new V3());
          ball.vel.copy(n).scale(4); ball.vel.x -= Math.sign(ball.pos.x) * 2; ball.vel.z -= Math.sign(ball.pos.z) * 2;
          ball.stuckT = 0;
        }
      } else ball.stuckT = 0;
    }
    for (const car of this.cars) {
      if (!this.arena.inBounds(car.pos) || !car.vel.isFinite() || !car.angVel.isFinite() || !Number.isFinite(car.rot.w)) {
        log('physics', 'car invalid; respawning', { id: car.id });
        const sp = this.arena.kickoffSpawns(car.team, 1, () => 0.9)[0];
        car.placeAt(sp.pos, sp.yaw);
      }
    }
  }

  onTouch(car, deltaSpeed) {
    const t = { id: car.id, team: car.team, tick: this.tick };
    const prev = this.lastTouch;
    this.lastTouch = t;
    this.event({ type: 'touch', car: car.id, strength: deltaSpeed, x: this.ball.pos.x, y: this.ball.pos.y, z: this.ball.pos.z });
    if (!this.authoritative) return;
    // count one touch per contact (not per tick of contact)
    if (!prev || prev.id !== car.id || this.tick - prev.tick > 12) {
      const st = this.stats.get(car.id); if (st) { st.touches++; st.score += 2; }
      this.touchHistory.push(t);
      if (this.touchHistory.length > 16) this.touchHistory.shift();
      this.pendingEval = { id: car.id, team: car.team, tick: this.tick, before: this.heading };
    } else if (this.pendingEval && this.pendingEval.id === car.id) {
      this.pendingEval.tick = this.tick;
    }
  }

  evaluateTouch() {
    const pe = this.pendingEval; this.pendingEval = null;
    const after = ballHeading(this.ball, this.arena, 4);
    this.heading = after;
    const st = this.stats.get(pe.id); if (!st) return;
    if (after === 1 - pe.team) { st.shots++; st.score += 20; this.shotBy = pe.id; this.event({ type: 'shot', car: pe.id }); }
    else if (this.shotBy === pe.id) this.shotBy = -1;
    if (pe.before === pe.team && after !== pe.team) { st.saves++; st.score += 50; this.event({ type: 'save', car: pe.id }); }
  }

  checkGoal() {
    const m = this.match;
    if (m.state !== 'live' && m.state !== 'free') return;
    const conceded = this.arena.goalConceded(this.ball.pos, this.ball.radius);
    if (conceded < 0) return;
    const team = 1 - conceded;
    const speed = this.ball.vel.len();
    if (m.state === 'free') {
      this.event({ type: 'goal', team, speed, training: true });
      this.ballHidden = true;
      return;
    }
    if (!this.authoritative) { this.ballHidden = true; return; } // clients wait for the server's verdict
    m.score[team]++;
    m.goalSeq++;
    let scorer = -1, assist = -1;
    const lt = this.lastTouch;
    if (lt && lt.team === team) {
      scorer = lt.id;
      const st = this.stats.get(scorer);
      if (st) { st.goals++; st.score += 100; if (this.shotBy !== scorer) { st.shots++; st.score += 20; } }
      this.shotBy = -1;
      for (let i = this.touchHistory.length - 1; i >= 0; i--) {
        const h = this.touchHistory[i];
        if ((this.tick - h.tick) * this.dt > MATCH.assistWindow) break;
        if (h.id !== scorer && h.team === team) {
          assist = h.id; const sa = this.stats.get(assist); if (sa) { sa.assists++; sa.score += 50; }
          break;
        }
      }
    }
    m.lastGoal = { team, scorer, assist, speed: round(speed, 10), tick: this.tick };
    m.state = 'goal';
    m.timer = MATCH.goalPause;
    this.ballHidden = true;
    // goal explosion pushes nearby cars away
    const gp = this.ball.pos;
    for (const c of this.cars) {
      const d = c.pos.dist(gp);
      if (d < 12) { const dir = new V3().subVectors(c.pos, gp).norm(); c.vel.addScaled(dir, (12 - d) * 1.2); c.vel.y += (12 - d) * 0.4; }
    }
    this.event({ type: 'goal', team, scorer, assist, speed, x: gp.x, y: gp.y, z: gp.z });
    if (m.overtime) m.timer = Math.min(m.timer, 4);
  }

  endMatch() {
    const m = this.match;
    m.state = 'ended';
    m.timer = 0;
    for (const c of this.cars) c.frozen = true;
    this.event({ type: 'end', score: [...m.score] });
  }

  winner() {
    const s = this.match.score;
    return s[0] > s[1] ? 0 : s[1] > s[0] ? 1 : -1;
  }

  // ---------------- serialisation (network snapshots) ----------------
  // Quantise state in place so every peer simulates from bit-identical numbers.
  quantize() {
    const q3 = (v) => { v.x = round(v.x, 1000); v.y = round(v.y, 1000); v.z = round(v.z, 1000); };
    const b = this.ball;
    q3(b.pos); q3(b.vel); q3(b.angVel);
    for (const c of this.cars) {
      q3(c.pos); q3(c.vel); q3(c.angVel);
      c.rot.x = round(c.rot.x, 10000); c.rot.y = round(c.rot.y, 10000); c.rot.z = round(c.rot.z, 10000); c.rot.w = round(c.rot.w, 10000);
      c.boost = round(c.boost, 100);
      c.jumpClock = round(c.jumpClock, 1000); c.dodgeTime = round(c.dodgeTime, 1000);
      c.boostTime = round(c.boostTime, 1000); c.jumpBuffer = round(c.jumpBuffer, 1000); c.airTime = round(c.airTime, 100);
      c.demoT = round(c.demoT, 1000); c.dodgeF = round(c.dodgeF, 10000); c.dodgeS = round(c.dodgeS, 10000);
      c.updateAxes();
    }
    const m = this.match;
    m.timer = round(m.timer, 1000); m.clock = round(m.clock, 1000);
    for (let i = 0; i < this.pads.length; i++) this.pads[i] = round(this.pads[i], 100);
  }

  serialize() {
    const m = this.match, b = this.ball;
    const lg = m.lastGoal;
    const match = [SC[m.state], m.timer, m.clock, m.overtime ? 1 : 0, m.score[0], m.score[1], m.kickoffs, m.goalSeq,
      lg ? lg.team : -1, lg ? lg.scorer : -1, lg ? lg.assist : -1, lg ? lg.speed : 0, m.waitingGround ? 1 : 0, this.ballHidden ? 1 : 0,
      this.lastTouch ? this.lastTouch.id : -1, this.lastTouch ? this.tick - this.lastTouch.tick : 0,
      this.demoSeq, this.lastDemo ? this.lastDemo.victim : -1, this.lastDemo ? this.lastDemo.attacker : -1];
    const ball = [b.pos.x, b.pos.y, b.pos.z, b.vel.x, b.vel.y, b.vel.z, b.angVel.x, b.angVel.y, b.angVel.z];
    const cars = this.cars.map((c) => {
      const flags = (c.onGround ? 1 : 0) | (c.jumped ? 2 : 0) | (c.jumping ? 4 : 0) | (c.doubleJumped ? 8 : 0) |
        (c.boosting ? 16 : 0) | (c.frozen ? 32 : 0) | (c.prevButtons << 6) | (c.supersonic ? 512 : 0);
      return [c.id, c.team, c.pos.x, c.pos.y, c.pos.z, c.rot.x, c.rot.y, c.rot.z, c.rot.w,
        c.vel.x, c.vel.y, c.vel.z, c.angVel.x, c.angVel.y, c.angVel.z, c.boost, flags,
        c.jumpClock, c.dodgeTime, c.boostTime, c.jumpBuffer, c.airTime, Math.min(9999, this.tick - c.lastKickTick), packInput(c.input),
        c.demoT, c.dodgeF, c.dodgeS];
    });
    const pads = [];
    for (let i = 0; i < this.pads.length; i++) if (this.pads[i] > 0) pads.push(i, this.pads[i]);
    return [this.tick, match, ball, cars, pads];
  }

  applySnapshot(s) {
    const [tick, match, ball, cars, pads] = s;
    this.tick = tick;
    const m = this.match;
    m.state = STATES[match[0]] || 'waiting'; m.timer = match[1]; m.clock = match[2]; m.overtime = !!match[3];
    m.score = [match[4], match[5]]; m.kickoffs = match[6]; m.goalSeq = match[7];
    m.lastGoal = match[8] >= 0 ? { team: match[8], scorer: match[9], assist: match[10], speed: match[11] } : null;
    m.waitingGround = !!match[12]; this.ballHidden = !!match[13];
    this.lastTouch = match[14] >= 0 ? { id: match[14], team: -1, tick: tick - match[15] } : null;
    this.demoSeq = match[16] || 0; this.lastDemo = match[17] >= 0 ? { victim: match[17], attacker: match[18] } : null;
    const b = this.ball;
    b.pos.set(ball[0], ball[1], ball[2]); b.vel.set(ball[3], ball[4], ball[5]); b.angVel.set(ball[6], ball[7], ball[8]);
    const seen = new Set();
    for (const a of cars) {
      const id = a[0]; seen.add(id);
      let c = this.car(id);
      if (!c) { c = this.addCar(id, a[1]); }
      c.team = a[1];
      c.pos.set(a[2], a[3], a[4]); c.rot.set(a[5], a[6], a[7], a[8]);
      c.vel.set(a[9], a[10], a[11]); c.angVel.set(a[12], a[13], a[14]); c.boost = a[15];
      const f = a[16];
      c.onGround = !!(f & 1); c.jumped = !!(f & 2); c.jumping = !!(f & 4); c.doubleJumped = !!(f & 8);
      c.boosting = !!(f & 16); c.frozen = !!(f & 32); c.prevButtons = (f >> 6) & 7; c.supersonic = !!(f & 512);
      c.jumpClock = a[17]; c.dodgeTime = a[18]; c.boostTime = a[19]; c.jumpBuffer = a[20]; c.airTime = a[21];
      c.lastKickTick = tick - a[22];
      c.input = unpackInput(a[23]);
      c.demoT = a[24] || 0; c.dodgeF = a[25] || 0; c.dodgeS = a[26] || 0;
      this.inputs.set(id, c.input);
      c.updateAxes();
    }
    for (const c of [...this.cars]) if (!seen.has(c.id)) this.removeCar(c.id);
    this.pads.fill(0);
    for (let i = 0; i < pads.length; i += 2) this.pads[pads[i]] = pads[i + 1];
  }

  // Copy full simulation state from another world (used by prediction rollback).
  copyFrom(w) { this.applySnapshot(w.serialize()); this.match.lastGoal = w.match.lastGoal; }
}

// Inputs are quantised to 1/100 so that server and predicting client use identical values.
export function packInput(i) {
  const q = (v) => Math.round(v * 100);
  return [q(i.throttle), q(i.steer), q(i.pitch), q(i.yaw), q(i.roll), (i.jump ? BTN_JUMP : 0) | (i.boost ? BTN_BOOST : 0) | (i.slide ? BTN_SLIDE : 0)];
}
export function unpackInput(a, out = neutralInput()) {
  if (!Array.isArray(a) || a.length < 6) return out;
  const f = (v) => (Number.isFinite(v) ? Math.max(-100, Math.min(100, Math.round(v))) / 100 : 0);
  out.throttle = f(a[0]); out.steer = f(a[1]); out.pitch = f(a[2]); out.yaw = f(a[3]); out.roll = f(a[4]);
  const b = a[5] | 0;
  out.jump = !!(b & BTN_JUMP); out.boost = !!(b & BTN_BOOST); out.slide = !!(b & BTN_SLIDE);
  return out;
}
export function quantizeInput(i) { return unpackInput(packInput(i)); }
