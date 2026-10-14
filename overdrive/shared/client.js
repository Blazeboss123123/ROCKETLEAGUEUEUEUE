// ClientSession: everything a player's machine does in an authoritative match.
//  - sends inputs (sequenced, redundantly, never state)
//  - predicts the whole world locally for instant response
//  - on each authoritative snapshot: rolls back, applies it, and re-simulates unacknowledged
//    inputs (server reconciliation); visual error is smoothed instead of snapping
//  - keeps lobby, roster, stats, ping and results for the UI
// Works with any connection object: { send(msg), close() } that calls session.receive(msg).

import { PHYSICS, NET, CAR, ARENA_VARIANTS } from './config.js';
import { World, packInput, quantizeInput } from './world.js';
import { neutralInput } from './car.js';
import { V3, Quat } from './math.js';
import { PROTOCOL_VERSION } from './protocol.js';

const SMOOTH_RATE = 10; // 1/s decay of visual correction offsets

export class ClientSession {
  constructor({ conn, name, cos, token, now, inputRedundancy, sendEvery }) {
    this.conn = conn;
    this.now = now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.name = name; this.cos = cos || {};
    this.token = token || null;
    this.pid = 0; this.code = ''; this.mode = ''; this.kind = ''; this.priv = false;
    this.lobby = null; this.roster = []; this.stats = {}; this.pings = {}; this.conn_ = {};
    this.world = null; this.mid = 0;
    this.seq = 0; this.pending = []; // [{seq, packed, inp}]
    this.acc = 0;
    this.lastSnapTick = -1;
    this.rtt = 0; this.lastPing = 0;
    this.result = null;
    this.events = [];        // presentation events (goal, chat, etc.)
    this.chat = [];
    this.closed = null;
    this.error = null;
    this.redundancy = inputRedundancy || NET.inputRedundancy;
    this.sendEvery = sendEvery || 2;
    this.smooth = new Map(); // id -> {off: V3, rot: Quat|null, rt}
    this.ballOff = new V3();
    this.prev = new Map();   // per-tick previous positions for render interpolation
    this.alpha = 0;
    this.snapCount = 0; this.corrections = 0; this.maxCorrection = 0;
    this.lastGoalSeq = 0;
    this.inputLatest = neutralInput();
    conn.send({ t: 'hello', name, cos, token: this.token, v: PROTOCOL_VERSION });
  }

  send(m) { if (!this.closed) this.conn.send(m); }

  // ---------------------------------------------------------------- incoming
  receive(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'welcome':
        this.pid = m.pid; this.token = m.token; this.code = m.code; this.mode = m.mode; this.kind = m.kind; this.priv = m.priv;
        this.events.push({ type: 'welcome' });
        break;
      case 'lobby': if (!this.lobby || m.v >= this.lobby.v || m.phase !== this.lobby.phase) this.lobby = m; break;
      case 'start': this.onStart(m); break;
      case 'snap': this.onSnap(m); break;
      case 'stats':
        if (m.mid === this.mid) { this.stats = m.stats; this.pings = m.ping; this.conn_ = m.conn; this.roster = m.roster; }
        break;
      case 'end': this.result = m; this.stats = m.stats; this.roster = m.roster; this.events.push({ type: 'end', result: m }); break;
      case 'pong': this.rtt = Math.max(0, this.now() - m.c); break;
      case 'chat': this.chat.push({ pid: m.pid, text: m.text, at: this.now() }); this.events.push({ type: 'chat', pid: m.pid, text: m.text }); break;
      case 'queue': this.queue = m; break;
      case 'closed': this.closed = m.reason || 'closed'; this.events.push({ type: 'closed', reason: this.closed }); break;
      case 'error': this.error = m; this.events.push({ type: 'error', code: m.code, msg: m.msg }); break;
      default: break;
    }
  }

  onStart(m) {
    if (this.world && m.mid === this.mid) return;
    this.mid = m.mid; this.mode = m.mode; this.roster = m.roster; this.result = null;
    this.arenaId = ARENA_VARIANTS[m.arena] ? m.arena : 'stadium';
    this.world = new World({ seed: m.seed, duration: m.duration, authoritative: false, arenaParams: ARENA_VARIANTS[this.arenaId].params });
    for (const r of m.roster) this.world.addCar(r.pid, r.team);
    this.world.startMatch();
    this.pending = []; this.lastSnapTick = -1; this.acc = 0; this.lastGoalSeq = 0; this.firstSnap = true; this.firstDemo = true;
    this.smooth.clear(); this.ballOff.set(0, 0, 0);
    this.events.push({ type: 'start', mid: m.mid });
  }

  onSnap(m) {
    const w = this.world;
    if (!w) return;
    const snap = m.s;
    if (!Array.isArray(snap) || snap[0] <= this.lastSnapTick) return; // out of order / duplicate
    this.lastSnapTick = snap[0];
    this.snapCount++;
    // remember where things are drawn now, to smooth the correction
    const before = new Map();
    for (const c of w.cars) before.set(c.id, { p: c.pos.clone(), q: c.rot.clone() });
    const ballBefore = w.ball.pos.clone();
        const prevState = w.match.state;

    w.applySnapshot(snap);
    const authDemoSeq = w.demoSeq || 0, authDemo = w.lastDemo;
    const ack = m.a && Number.isInteger(m.a[this.pid]) ? m.a[this.pid] : -1;
    if (ack >= 0) while (this.pending.length && this.pending[0].seq <= ack) this.pending.shift();
    // re-simulate inputs the authority has not processed yet
    w.emitEvents = false;
    const me = w.car(this.pid);
    for (const p of this.pending) {
      if (me) w.setInput(this.pid, p.inp);
      w.step();
    }
    w.events.length = 0;
    w.emitEvents = true;

    // goals are decided only by the authority
    if (this.firstSnap) { this.firstSnap = false; this.lastGoalSeq = w.match.goalSeq; }
    if (w.match.goalSeq > this.lastGoalSeq && w.match.lastGoal) {
      this.events.push({ type: 'goal', ...w.match.lastGoal, x: ballBefore.x, y: ballBefore.y, z: ballBefore.z });
      this.lastGoalSeq = w.match.goalSeq;
    }
    if (prevState !== w.match.state) this.events.push({ type: 'state', from: prevState, to: w.match.state });

    // visual smoothing of the correction
    for (const c of w.cars) {
      const b = before.get(c.id);
      let s = this.smooth.get(c.id);
      if (!s) { s = { off: new V3(), rot: new Quat(), rt: 0 }; this.smooth.set(c.id, s); }
      if (!b) continue;
      const dx = b.p.x - c.pos.x, dy = b.p.y - c.pos.y, dz = b.p.z - c.pos.z;
      const err = Math.hypot(dx, dy, dz);
      if (c.id === this.pid && err > 0.01) { this.corrections++; this.maxCorrection = Math.max(this.maxCorrection, err); }
      if (err > 6 || prevState === 'countdown' || w.match.state === 'countdown') { s.off.set(0, 0, 0); s.rt = 0; continue; }
      s.off.x += dx; s.off.y += dy; s.off.z += dz;
      s.off.clampLen(3);
      // rotation: blend from the drawn orientation
      s.rot.copy(b.q); s.rt = 1;
    }
    const bdx = ballBefore.x - w.ball.pos.x, bdy = ballBefore.y - w.ball.pos.y, bdz = ballBefore.z - w.ball.pos.z;
    if (Math.hypot(bdx, bdy, bdz) < 6 && !w.ballHidden) { this.ballOff.x += bdx; this.ballOff.y += bdy; this.ballOff.z += bdz; this.ballOff.clampLen(4); }
    else this.ballOff.set(0, 0, 0);
    // keep render interpolation continuous: shift the previous-tick sample by the same correction
    for (const c of w.cars) {
      const b = before.get(c.id), p = this.prev.get(c.id);
      if (b && p) { p.p.x += c.pos.x - b.p.x; p.p.y += c.pos.y - b.p.y; p.p.z += c.pos.z - b.p.z; }
      else if (!p) this.capturePrev();
    }
    const pb = this.prev.get('ball');
    if (pb) { pb.p.x += w.ball.pos.x - ballBefore.x; pb.p.y += w.ball.pos.y - ballBefore.y; pb.p.z += w.ball.pos.z - ballBefore.z; }
    // demolitions are announced from authoritative state only
    if (this.firstDemo) { this.firstDemo = false; this.authDemoSeq = authDemoSeq; }
    else if (authDemoSeq > (this.authDemoSeq || 0) && authDemo) {
      this.authDemoSeq = authDemoSeq;
      const v = before.get(authDemo.victim);
      this.events.push({ type: 'demo', victim: authDemo.victim, attacker: authDemo.attacker, x: v ? v.p.x : 0, y: v ? v.p.y : 1, z: v ? v.p.z : 0 });
    }
  }

  capturePrev() {
    const w = this.world; if (!w) return;
    for (const c of w.cars) {
      let p = this.prev.get(c.id);
      if (!p) { p = { p: new V3(), q: new Quat() }; this.prev.set(c.id, p); }
      p.p.copy(c.pos); p.q.copy(c.rot);
    }
    let b = this.prev.get('ball');
    if (!b) { b = { p: new V3(), q: null }; this.prev.set('ball', b); }
    b.p.copy(w.ball.pos);
  }

  // ---------------------------------------------------------------- outgoing / stepping
  // Advance real time. `input` is this frame's control state. Returns number of ticks run.
  update(realDt, input) {
    const now = this.now();
    if (now - this.lastPing > 1000) { this.lastPing = now; this.send({ t: 'ping', c: now }); }
    const w = this.world;
    if (!w || this.closed) return 0;
    const q = quantizeInput(input || neutralInput());
    this.inputLatest = q;
    this.acc += Math.min(realDt, 0.25);
    let n = 0;
    const me = w.car(this.pid);
    while (this.acc >= PHYSICS.dt) {
      this.acc -= PHYSICS.dt;
      this.capturePrev();
      if (me && this.lobby?.phase !== 'results') {
        this.seq++;
        const packed = packInput(q);
        this.pending.push({ seq: this.seq, packed, inp: q });
        if (this.pending.length > 600) this.pending.shift(); // authority unreachable; cap memory
        w.setInput(this.pid, q);
        if (this.seq % this.sendEvery === 0) this.flushInputs();
      }
      w.step();
      n++;
    }
    this.alpha = this.acc / PHYSICS.dt;
    // decay visual offsets
    const k = Math.exp(-SMOOTH_RATE * realDt);
    for (const s of this.smooth.values()) { s.off.scale(k); s.rt *= Math.exp(-14 * realDt); }
    this.ballOff.scale(Math.exp(-14 * realDt));
    return n;
  }

  flushInputs() {
    const recent = this.pending.slice(-this.redundancy);
    if (!recent.length) return;
    this.send({ t: 'in', s: recent[0].seq, i: recent.map((p) => p.packed) });
  }

  // Render state for an entity: interpolated between the last two ticks plus correction offset.
  carRender(car, outPos, outQuat) {
    const prev = this.prev.get(car.id);
    const a = this.alpha;
    if (prev) {
      outPos.set(prev.p.x + (car.pos.x - prev.p.x) * a, prev.p.y + (car.pos.y - prev.p.y) * a, prev.p.z + (car.pos.z - prev.p.z) * a);
      slerpInto(outQuat, prev.q, car.rot, a);
    } else { outPos.copy(car.pos); outQuat.copy(car.rot); }
    const s = this.smooth.get(car.id);
    if (s) {
      outPos.add(s.off);
      if (s.rt > 0.01) slerpInto(outQuat, outQuat, s.rot, s.rt);
    }
  }
  ballRender(outPos) {
    const w = this.world, prev = this.prev.get('ball'), a = this.alpha, b = w.ball.pos;
    if (prev) outPos.set(prev.p.x + (b.x - prev.p.x) * a, prev.p.y + (b.y - prev.p.y) * a, prev.p.z + (b.z - prev.p.z) * a);
    else outPos.copy(b);
    outPos.add(this.ballOff);
  }

  chatSend(q) { this.send({ t: 'chat', q }); }
  ready(v) { this.send({ t: 'ready', v }); }
  team(v) { this.send({ t: 'team', v }); }
  start() { this.send({ t: 'start' }); }
  setFill(v) { this.send({ t: 'fill', v }); }
  rematch() { this.send({ t: 'rematch' }); }
  toLobby() { this.send({ t: 'tolobby' }); }
  leave() { this.send({ t: 'leave' }); this.closed = 'left'; this.conn.close?.(); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  playerName(pid) { const r = this.roster.find((x) => x.pid === pid) || this.lobby?.players.find((x) => x.pid === pid); return r ? r.name : '?'; }
  playerInfo(pid) { return this.roster.find((x) => x.pid === pid) || this.lobby?.players.find((x) => x.pid === pid) || null; }
}

export function slerpInto(out, a, b, t) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let k0, k1;
  if (cos > 0.9995) { k0 = 1 - t; k1 = t; }
  else { const th = Math.acos(cos), s = Math.sin(th); k0 = Math.sin((1 - t) * th) / s; k1 = Math.sin(t * th) / s; }
  out.set(a.x * k0 + bx * k1, a.y * k0 + by * k1, a.z * k0 + bz * k1, a.w * k0 + bw * k1);
  return out.norm();
}

// In-process connection pair (offline matches and the browser host's own player).
export function localPair(host) {
  let session = null;
  let pid = 0, joining = false;
  const queue = [], held = [];
  const conn = {
    send(msg) {
      const m = JSON.parse(JSON.stringify(msg)); // identical semantics to a real wire
      if (m.t === 'hello') {
        joining = true;
        const r = host.join(m.name, m.cos, m.token);
        joining = false; pid = r.pid || 0;
        for (const h of held.splice(0)) if (h.target === null || h.target === pid) push(h.msg);
        return;
      }
      host.handle(pid, m);
    },
    close() { if (pid) host.disconnect(pid); },
  };
  function push(msg) {
    const m = JSON.parse(JSON.stringify(msg));
    if (session) session.receive(m); else queue.push(m);
  }
  return {
    conn,
    attach(s) { session = s; for (const m of queue.splice(0)) s.receive(m); },
    deliver(target, msg) {
      if (joining) { held.push({ target, msg }); return; }
      if (target !== null && target !== pid) return;
      push(msg);
    },
    get pid() { return pid; },
  };
}
