// Local training: free play and drills (shooting, aerials, saves, dribbling). No opponents.
import { World } from '../shared/world.js';
import { PHYSICS } from '../shared/config.js';
import { quantizeInput } from '../shared/world.js';
import { V3, Quat, rng } from '../shared/math.js';
import { slerpInto } from '../shared/client.js';

export const DRILLS = {
  free: { name: 'Free Play', desc: 'Open pitch with a ball. Toggle unlimited boost from the pause menu.' },
  shooting: { name: 'Striker Drill', desc: '8 rolling balls. Put them in the orange net.', count: 8, time: 10 },
  aerial: { name: 'Aerial Drill', desc: '6 lofted balls. Meet them in the air and score.', count: 6, time: 12 },
  saves: { name: 'Goalkeeper Drill', desc: '8 shots at your goal. Keep them out.', count: 8, time: 6 },
  dribble: { name: 'Dribble Drill', desc: 'Keep the ball on your car. Best streak counts.', count: 5, time: 30 },
};

export class TrainingSession {
  constructor(drill = 'free', opts = {}) {
    this.drill = DRILLS[drill] ? drill : 'free';
    this.pid = 1;
    this.world = new World({ free: true, unlimitedBoost: drill === 'free' ? !!opts.unlimitedBoost : drill === 'aerial', startBoost: 100 });
    this.world.match.state = 'free';
    this.car = this.world.addCar(1, 0);
    this.rand = rng(Date.now() & 0xffff);
    this.acc = 0; this.alpha = 0;
    this.prev = new Map();
    this.events = [];
    this.round = 0; this.success = 0; this.timer = 0; this.resetT = 0; this.done = false; this.message = ''; this.best = 0; this.streak = 0;
    this.roster = [{ pid: 1, name: opts.name || 'You', team: 0, cos: opts.cos }];
    this.kind = 'training';
    this.setup();
  }

  get unlimitedBoost() { return this.world.unlimitedBoost; }
  set unlimitedBoost(v) { this.world.unlimitedBoost = v; }

  setup() {
    const w = this.world, car = this.car, b = w.ball, a = w.arena, r = this.rand;
    w.ballHidden = false;
    const d = DRILLS[this.drill];
    this.timer = d.time || 0;
    if (this.drill === 'free') {
      if (this.round === 0) car.placeAt(new V3(0, 0.36, -30), 0);
      b.reset(); b.pos.set(0, 6, 0);
    } else if (this.drill === 'shooting') {
      const x = (r() - 0.5) * 30, z = 6 + r() * 14;
      b.reset(); b.pos.set(x, b.radius, z); b.vel.set((r() - 0.5) * 6, 0, 2 + r() * 4);
      car.placeAt(new V3(x + (r() - 0.5) * 8, 0.36, z - 18), 0); car.boost = 60;
    } else if (this.drill === 'aerial') {
      const x = (r() - 0.5) * 16, z = 18 + r() * 10;
      b.reset(); b.pos.set(x, 6 + r() * 3, z); b.vel.set(0, 6 + r() * 2, 0);
      car.placeAt(new V3(x * 0.5, 0.36, z - 22), 0); car.boost = 100;
    } else if (this.drill === 'saves') {
      const x = (r() - 0.5) * 34, z = -10 - r() * 12;
      const tx = (r() - 0.5) * a.goalHalfW * 1.6, ty = 1 + r() * 4;
      b.reset(); b.pos.set(x, 1 + r() * 2, z);
      const T = 1.6 + r() * 0.8;
      b.vel.set((tx - x) / T, (ty - b.pos.y) / T + 0.5 * 6.5 * T, (-a.halfL - 1 - z) / T);
      car.placeAt(new V3(0, 0.36, -a.halfL + 2), 0); car.boost = 100;
    } else if (this.drill === 'dribble') {
      car.placeAt(new V3(0, 0.36, -20), 0);
      b.reset(); b.pos.set(0, 0.36 + 0.25 + b.radius + 0.05, -20 + 0.1); b.vel.set(0, 0, 0);
      this.streak = 0;
    }
    car.boost = this.drill === 'free' ? Math.max(car.boost, 33) : car.boost;
    this.resetT = 0;
    this.events.push({ type: 'drill', round: this.round });
  }

  next(success) {
    if (this.drill === 'free') { this.round++; this.setup(); return; }
    if (success) this.success++;
    this.round++;
    const d = DRILLS[this.drill];
    if (this.round >= d.count) { this.done = true; this.message = `${d.name} complete: ${this.drill === 'dribble' ? 'best ' + this.best.toFixed(1) + ' s' : this.success + ' / ' + d.count}`; this.events.push({ type: 'drillDone' }); return; }
    this.setup();
  }

  restart() { this.round = 0; this.success = 0; this.done = false; this.best = 0; this.setup(); }

  update(realDt, input) {
    const w = this.world;
    this.acc += Math.min(realDt, 0.25);
    const q = quantizeInput(input);
    let n = 0;
    while (this.acc >= PHYSICS.dt) {
      this.acc -= PHYSICS.dt;
      this.capturePrev();
      w.setInput(1, q);
      w.step();
      for (const e of w.events) this.events.push(e);
      w.events.length = 0;
      this.rules(PHYSICS.dt);
      n++;
    }
    this.alpha = this.acc / PHYSICS.dt;
    return n;
  }

  rules(dt) {
    if (this.done) return;
    const w = this.world, b = w.ball;
    const goal = this.events.find((e) => e.type === 'goal' && !e.handled);
    if (goal) goal.handled = true;
    if (this.resetT > 0) { this.resetT -= dt; if (this.resetT <= 0) this.next(this.pendingSuccess); return; }
    if (this.timer > 0) this.timer -= dt;
    const finish = (ok, msg, delay = 1.2) => { this.pendingSuccess = ok; this.resetT = delay; this.message = msg; this.events.push({ type: ok ? 'drillOk' : 'drillFail' }); };
    switch (this.drill) {
      case 'free': if (goal) finish(true, goal.team === 0 ? 'Goal!' : 'Own goal!', 2); break;
      case 'shooting': case 'aerial':
        if (goal) finish(goal.team === 0, goal.team === 0 ? 'Goal!' : 'Wrong net!');
        else if (this.timer <= 0) finish(false, 'Out of time');
        break;
      case 'saves':
        if (goal) finish(false, 'Conceded');
        else if (this.timer <= 0 || (b.vel.z > 4 && b.pos.z > -20)) finish(true, 'Saved!');
        break;
      case 'dribble': {
        const onCar = b.pos.y > 1.0 && b.pos.dist(this.car.pos) < 2.2;
        if (onCar) { this.streak += dt; this.best = Math.max(this.best, this.streak); }
        if (b.pos.y < b.radius + 0.15 && this.streak >= 0) finish(this.streak > 3, `Kept it up ${this.streak.toFixed(1)} s`, 1.0);
        else if (this.timer <= 0) finish(true, `Kept it up ${this.streak.toFixed(1)} s`, 1.0);
        break;
      }
    }
  }

  capturePrev() {
    for (const c of this.world.cars) {
      let p = this.prev.get(c.id); if (!p) { p = { p: new V3(), q: new Quat() }; this.prev.set(c.id, p); }
      p.p.copy(c.pos); p.q.copy(c.rot);
    }
    let b = this.prev.get('ball'); if (!b) { b = { p: new V3() }; this.prev.set('ball', b); }
    b.p.copy(this.world.ball.pos);
  }
  carRender(car, outPos, outQuat) {
    const prev = this.prev.get(car.id), a = this.alpha;
    if (prev) { outPos.set(prev.p.x + (car.pos.x - prev.p.x) * a, prev.p.y + (car.pos.y - prev.p.y) * a, prev.p.z + (car.pos.z - prev.p.z) * a); slerpInto(outQuat, prev.q, car.rot, a); }
    else { outPos.copy(car.pos); outQuat.copy(car.rot); }
  }
  ballRender(out) {
    const prev = this.prev.get('ball'), b = this.world.ball.pos, a = this.alpha;
    if (prev) out.set(prev.p.x + (b.x - prev.p.x) * a, prev.p.y + (b.y - prev.p.y) * a, prev.p.z + (b.z - prev.p.z) * a); else out.copy(b);
  }
  drainEvents() { const e = this.events; this.events = []; return e; }
}
