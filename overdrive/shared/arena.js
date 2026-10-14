// Arena geometry as a signed distance field (SDF).
// interior(p) returns the distance from p to the nearest arena surface,
// POSITIVE inside the playable volume (arena + both goal boxes), negative inside walls.
// The same function drives car/ball collisions, wall driving, camera collision and
// mesh generation, so visible surfaces and collision surfaces always match.

import { ARENA, BOOST_PADS } from './config.js';
import { V3 } from './math.js';

export class Arena {
  constructor(params = ARENA) {
    this.p = { ...ARENA, ...params };
    const a = this.p;
    this.halfL = a.length / 2;
    this.halfW = a.width / 2;
    this.halfH = a.height / 2;
    this.goalHalfW = a.goalWidth / 2;
    // goal box: overlaps past the floor fillet so the goal mouth has no lip
    this.goalZ0 = this.halfL - a.wallCurve - 0.5;
    this.goalZ1 = this.halfL + a.goalDepth;
    this.goalCZ = (this.goalZ0 + this.goalZ1) / 2;
    this.goalHZ = (this.goalZ1 - this.goalZ0) / 2;
    this.pads = buildPadLayout(this);
  }

  // signed distance, positive inside the playable space
  interior(x, y, z) {
    const a = this.p;
    // --- main bowl: rounded-rectangle plan, extruded, with filleted floor/ceiling edges
    const r = a.wallCurve, Rc = a.cornerRadius;
    const qx = Math.abs(x) - (this.halfW - Rc);
    const qz = Math.abs(z) - (this.halfL - Rc);
    const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
    const d2 = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - Rc; // <0 inside plan
    const u = d2 + r;
    const v = Math.abs(y - this.halfH) - (this.halfH - r);
    const ou = u > 0 ? u : 0, ov = v > 0 ? v : 0;
    const dMain = Math.sqrt(ou * ou + ov * ov) + Math.min(Math.max(u, v), 0) - r;
    // --- goal boxes (mirrored in z)
    const g = a.goalCurve;
    const bx = Math.abs(x) - (this.goalHalfW - g);
    const by = Math.abs(y - a.goalHeight / 2) - (a.goalHeight / 2 - g);
    const bz = Math.abs(Math.abs(z) - this.goalCZ) - (this.goalHZ - g);
    const obx = bx > 0 ? bx : 0, oby = by > 0 ? by : 0, obz = bz > 0 ? bz : 0;
    const dGoal = Math.sqrt(obx * obx + oby * oby + obz * obz) + Math.min(Math.max(bx, Math.max(by, bz)), 0) - g;
    // union of free space
    return Math.max(-dMain, -dGoal);
  }

  // Inward-pointing surface normal at p (gradient of interior), written into out.
  normal(x, y, z, out) {
    const e = 0.01;
    const nx = this.interior(x + e, y, z) - this.interior(x - e, y, z);
    const ny = this.interior(x, y + e, z) - this.interior(x, y - e, z);
    const nz = this.interior(x, y, z + e) - this.interior(x, y, z - e);
    out.set(nx, ny, nz);
    const l = out.len();
    if (l < 1e-9) out.set(0, 1, 0); else out.scale(1 / l);
    return out;
  }

  // Which goal (if any) the ball is fully inside. Returns team index that CONCEDED or -1.
  // A goal requires the entire ball to be past the goal line inside the mouth.
  goalConceded(ball, radius) {
    const pz = ball.z;
    if (Math.abs(ball.x) > this.goalHalfW || ball.y > this.p.goalHeight) return -1;
    if (pz > this.halfL + radius) return 1;   // orange goal (+Z) — orange concedes
    if (pz < -this.halfL - radius) return 0;  // blue goal (-Z)
    return -1;
  }

  goalCenter(team, out = new V3()) {
    // centre of the goal mouth defended by `team`
    return out.set(0, this.p.goalHeight / 2, team === 0 ? -this.halfL : this.halfL);
  }

  inBounds(p) {
    return p.isFinite() && Math.abs(p.x) < this.p.worldLimit && Math.abs(p.z) < this.p.worldLimit && p.y > -5 && p.y < this.p.height + 10;
  }

  // Kickoff spawn positions for a team. Returns [{pos, yaw}] (yaw: rotation about +Y, 0 faces +Z).
  kickoffSpawns(team, count, seedRand) {
    const L = this.halfL;
    const s = L / 48; // scale positions with arena length
    const dir = team === 0 ? -1 : 1;
    const diagonal = [{ x: -19 * s, z: 24 * s }, { x: 19 * s, z: 24 * s }];
    const offCenter = [{ x: -2.5, z: 36 * s }, { x: 2.5, z: 36 * s }];
    const back = { x: 0, z: 43 * s };
    // pick a deterministic, symmetric pattern
    const r = seedRand ? seedRand() : 0;
    let order;
    if (count === 1) order = [r < 0.4 ? diagonal[r < 0.2 ? 0 : 1] : r < 0.8 ? offCenter[r < 0.6 ? 0 : 1] : back];
    else if (count === 2) order = r < 0.5 ? [diagonal[0], diagonal[1]] : [diagonal[r < 0.75 ? 0 : 1], back];
    else if (count === 3) order = r < 0.5 ? [diagonal[0], diagonal[1], back] : [diagonal[0], offCenter[1], back];
    else order = [diagonal[0], diagonal[1], offCenter[0], offCenter[1]].concat([back]);
    const out = [];
    for (let i = 0; i < count; i++) {
      const o = order[i % order.length];
      // orange is the point-mirror of blue so kickoffs are perfectly fair
      const px = team === 0 ? o.x : -o.x;
      const pos = new V3(px, 0.36, dir * o.z);
      // face the ball
      const yaw = Math.atan2(-pos.x, -pos.z);
      out.push({ pos, yaw });
    }
    return out;
  }
}

// Designed boost layout: mirrored across both axes. Large pads at the mid-side lanes and in
// the attacking corners (rotation fuel); small pads trace the rotation lanes, the midfield
// challenge zone and the back-post recovery paths.
function buildPadLayout(arena) {
  const sx = arena.halfW / 35, sz = arena.halfL / 48;
  const pads = [];
  const add = (x, z, large) => pads.push({ x: x * sx, y: 0, z: z * sz, large, id: pads.length });
  // large
  add(-29, 0, true); add(29, 0, true);
  for (const z of [-37, 37]) { add(-27, z, true); add(27, z, true); }
  // small, quadrant-mirrored
  add(-12, 0, false); add(12, 0, false);
  for (const z of [-10, 10]) { add(0, z, false); add(-20, z, false); add(20, z, false); }
  for (const z of [-22, 22]) { add(-8, z, false); add(8, z, false); add(-30, z, false); add(30, z, false); }
  for (const z of [-32, 32]) { add(0, z, false); add(-16, z, false); add(16, z, false); }
  for (const z of [-43, 43]) { add(-10, z, false); add(10, z, false); }
  for (const p of pads) {
    const cfg = p.large ? BOOST_PADS.large : BOOST_PADS.small;
    p.amount = cfg.amount; p.respawn = cfg.respawn; p.radius = cfg.radius; p.height = cfg.height;
  }
  return pads;
}
