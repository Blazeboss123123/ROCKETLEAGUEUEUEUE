// Arena geometry as a signed distance field (SDF).
// interior(x, y, z) is the distance from a point to the nearest arena surface: POSITIVE inside
// the playable volume, negative inside walls. The same function drives car/ball collisions,
// wall driving, camera collision and mesh generation, so visible and collision surfaces match.
//
// Plan view is a convex polygon with rounded corners (a rectangle for Soccar/Hoops, an
// elongated hexagon for Dropshot), extruded and filleted to the floor and ceiling. The back
// walls use a much tighter fillet than the side walls, so there are no ramps beside the goals.
// Modes add their own features: goal boxes (Soccar), rims (Hoops), breakable floor (Dropshot).

import { ARENA, BOOST_PADS, HOOPS, DROPSHOT } from './config.js';
import { V3 } from './math.js';

const SQ3 = Math.sqrt(3);

export class Arena {
  constructor(params = {}) {
    this.p = { ...ARENA, ...params };
    const a = this.p;
    this.mode = a.mode || 'soccar';
    this.halfL = a.length / 2;
    this.halfW = a.width / 2;
    this.halfH = a.height / 2;
    this.rSide = a.wallCurve;
    this.rEnd = a.endCurve ?? a.wallCurve;
    this.Rc = a.cornerRadius;
    // ---- plan polygon (outer outline before corner rounding), counter-clockwise in (x, z)
    if (a.plan === 'hex') {
      const t = this.halfW * 0.5;
      this.outer = [[t, -this.halfL], [this.halfW, 0], [t, this.halfL], [-t, this.halfL], [-this.halfW, 0], [-t, -this.halfL]];
    } else {
      this.outer = [[this.halfW, -this.halfL], [this.halfW, this.halfL], [-this.halfW, this.halfL], [-this.halfW, -this.halfL]];
    }
    this.isRect = a.plan !== 'hex';
    this.inner = insetPolygon(this.outer, this.Rc);
    // ---- soccar goals
    this.goalHalfW = a.goalWidth / 2;
    this.goalZ0 = this.halfL - this.rEnd - 0.6; // goal box reaches past the back-wall fillet: flat goal mouth
    this.goalZ1 = this.halfL + a.goalDepth;
    this.goalCZ = (this.goalZ0 + this.goalZ1) / 2;
    this.goalHZ = (this.goalZ1 - this.goalZ0) / 2;
    // ---- hoops
    this.rimY = HOOPS.rimHeight;
    this.rimR = HOOPS.rimRadius + HOOPS.rimTube; // centre-line radius of the rim tube
    this.hoopZ = this.halfL - this.rimR - HOOPS.rimTube - HOOPS.wallGap;
    // ---- dropshot tiles
    this.tiles = [];
    this.tileState = null; // Uint8Array owned by the World: 0 intact, 1 damaged, 2 open
    this.tileIndex = new Map();
    if (this.mode === 'dropshot') this.buildTiles();
    this.pads = this.mode === 'dropshot' ? [] : buildPadLayout(this);
  }

  // ---------------------------------------------------------------- plan helpers
  // signed distance to the rounded plan outline (negative inside), plus how "side-wall" the
  // nearest wall is (1 = side wall, 0 = back wall) for the variable fillet radius.
  planDist(x, z) {
    if (this.isRect) {
      const qx = Math.abs(x) - (this.halfW - this.Rc), qz = Math.abs(z) - (this.halfL - this.Rc);
      const ox = qx > 0 ? qx : 0, oz = qz > 0 ? qz : 0;
      const d = Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - this.Rc;
      let side;
      if (qx > 0 && qz > 0) { const l = Math.sqrt(qx * qx + qz * qz); side = (qx / l) * (qx / l); }
      else side = qx > qz ? 1 : 0;
      this._side = side;
      return d;
    }
    this._side = 1;
    return sdPolygon(this.inner, x, z) - this.Rc;
  }
  wallCurveFor(side) { return this.rEnd + (this.rSide - this.rEnd) * side; }

  // extruded bowl with floor at floorY
  bowl(x, y, z, floorY) {
    const d2 = this.planDist(x, z);
    const r = this.isRect ? this.wallCurveFor(this._side) : this.rSide;
    const H = this.p.height;
    const c = (H + floorY) / 2, half = (H - floorY) / 2;
    const u = d2 + r;
    const v = Math.abs(y - c) - (half - r);
    const ou = u > 0 ? u : 0, ov = v > 0 ? v : 0;
    return Math.sqrt(ou * ou + ov * ov) + Math.min(Math.max(u, v), 0) - r; // <0 inside
  }

  // ---------------------------------------------------------------- SDF
  interior(x, y, z, forBall = false) {
    let floorY = 0;
    if (forBall && this.mode === 'dropshot' && y < 2.5 && this.holeAt(x, z, y)) floorY = -DROPSHOT.holeDepth;
    let d = -this.bowl(x, y, z, floorY);
    if (this.mode === 'soccar') {
      const a = this.p, g = a.goalCurve;
      const bx = Math.abs(x) - (this.goalHalfW - g);
      const by = Math.abs(y - a.goalHeight / 2) - (a.goalHeight / 2 - g);
      const bz = Math.abs(Math.abs(z) - this.goalCZ) - (this.goalHZ - g);
      const obx = bx > 0 ? bx : 0, oby = by > 0 ? by : 0, obz = bz > 0 ? bz : 0;
      const dGoal = Math.sqrt(obx * obx + oby * oby + obz * obz) + Math.min(Math.max(bx, Math.max(by, bz)), 0) - g;
      if (-dGoal > d) d = -dGoal;
    } else if (this.mode === 'hoops') {
      // solid rim tube (torus) at each end: free space is outside it
      const dz = Math.abs(z) - this.hoopZ;
      const qx = Math.sqrt(x * x + dz * dz) - this.rimR, qy = y - this.rimY;
      const dRim = Math.sqrt(qx * qx + qy * qy) - HOOPS.rimTube;
      if (dRim < d) d = dRim;
    }
    return d;
  }

  // Inward-pointing surface normal (gradient of interior).
  normal(x, y, z, out, forBall = false) {
    const e = 0.01;
    const nx = this.interior(x + e, y, z, forBall) - this.interior(x - e, y, z, forBall);
    const ny = this.interior(x, y + e, z, forBall) - this.interior(x, y - e, z, forBall);
    const nz = this.interior(x, y, z + e, forBall) - this.interior(x, y, z - e, forBall);
    out.set(nx, ny, nz);
    const l = out.len();
    if (l < 1e-9) out.set(0, 1, 0); else out.scale(1 / l);
    return out;
  }

  // ---------------------------------------------------------------- scoring
  // Team that CONCEDED (whose goal / hoop / floor the ball is in), or -1.
  goalConceded(pos, radius, vel) {
    if (this.mode === 'hoops') {
      const dz = Math.abs(pos.z) - this.hoopZ;
      const dist = Math.sqrt(pos.x * pos.x + dz * dz);
      if (dist < HOOPS.rimRadius - 0.15 && pos.y < this.rimY - radius * 0.35 && pos.y > this.rimY - HOOPS.netDepth - radius && (!vel || vel.y < 1)) return pos.z > 0 ? 1 : 0;
      return -1;
    }
    if (this.mode === 'dropshot') {
      if (pos.y < -1.2) return pos.z > 0 ? 1 : 0;
      return -1;
    }
    if (Math.abs(pos.x) > this.goalHalfW || pos.y > this.p.goalHeight) return -1;
    if (pos.z > this.halfL + radius) return 1;   // orange goal (+Z) — orange concedes
    if (pos.z < -this.halfL - radius) return 0;  // blue goal (-Z)
    return -1;
  }

  goalCenter(team, out = new V3()) {
    const s = team === 0 ? -1 : 1;
    if (this.mode === 'hoops') return out.set(0, this.rimY, s * this.hoopZ);
    if (this.mode === 'dropshot') return out.set(0, 0, s * this.halfL * 0.5);
    return out.set(0, this.p.goalHeight / 2, s * this.halfL);
  }

  // Ball placement at kickoff (height depends on mode).
  kickoffBallY(radius) {
    if (this.mode === 'hoops') return HOOPS.kickoffBallHeight;
    if (this.mode === 'dropshot') return DROPSHOT.kickoffBallHeight;
    return radius;
  }

  inBounds(p) {
    return p.isFinite() && Math.abs(p.x) < this.p.worldLimit && Math.abs(p.z) < this.p.worldLimit && p.y > -DROPSHOT.holeDepth - 5 && p.y < this.p.height + 10;
  }

  // Kickoff spawn positions for a team. Returns [{pos, yaw}] (yaw: rotation about +Y, 0 faces +Z).
  kickoffSpawns(team, count, seedRand) {
    const L = this.halfL;
    const s = L / 48; // scale positions with arena length
    const w = Math.min(1, this.halfW / 35);
    const dir = team === 0 ? -1 : 1;
    const diagonal = [{ x: -19 * s * w, z: 24 * s }, { x: 19 * s * w, z: 24 * s }];
    const offCenter = [{ x: -2.5, z: 36 * s }, { x: 2.5, z: 36 * s }];
    const back = { x: 0, z: 43 * s - (this.mode === 'hoops' ? 4 : 0) };
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
      const yaw = Math.atan2(-pos.x, -pos.z);
      out.push({ pos, yaw });
    }
    return out;
  }

  // ---------------------------------------------------------------- dropshot floor
  // Flat-top hexagon tiles in axial coordinates (q, r): centre x = 1.5 R q, z = sqrt3 R (r + q/2).
  buildTiles() {
    const R = DROPSHOT.tileRadius;
    const margin = this.rSide + R * 0.55;
    const n = Math.ceil(Math.max(this.halfL, this.halfW) / R) + 2;
    for (let q = -n; q <= n; q++) for (let r = -2 * n; r <= 2 * n; r++) {
      const x = 1.5 * R * q, z = SQ3 * R * (r + q / 2);
      if (Math.abs(z) < 1e-6) continue; // no tile straddles the halfway line
      if (this.planDist(x, z) > -margin) continue;
      const t = { q, r, x, z, team: z < 0 ? 0 : 1 };
      this.tileIndex.set(q + ',' + r, this.tiles.length);
      this.tiles.push(t);
    }
  }
  tileAt(x, z) {
    const R = DROPSHOT.tileRadius;
    const fq = (2 / 3) * x / R, fr = (-x / 3 + (SQ3 / 3) * z) / R;
    // cube rounding
    let rx = Math.round(fq), rz = Math.round(fr), ry = Math.round(-fq - fr);
    const dx = Math.abs(rx - fq), dz = Math.abs(rz - fr), dy = Math.abs(ry + fq + fr);
    if (dx > dy && dx > dz) rx = -ry - rz; else if (dy <= dz) rz = -rx - ry;
    const i = this.tileIndex.get(rx + ',' + rz);
    return i === undefined ? -1 : i;
  }
  holeAt(x, z, y) {
    if (!this.tileState) return false;
    const i = this.tileAt(x, z);
    if (i >= 0 && this.tileState[i] >= 2) return true;
    if (y < -0.1) {
      // already below the floor: keep the hole open around the edges so the ball cannot snag
      const R = DROPSHOT.tileRadius * 0.6;
      for (const [ox, oz] of [[R, 0], [-R, 0], [0, R], [0, -R]]) { const j = this.tileAt(x + ox, z + oz); if (j >= 0 && this.tileState[j] >= 2) return true; }
    }
    return false;
  }
  tilesWithin(i, radius) {
    const t = this.tiles[i], out = [];
    for (let j = 0; j < this.tiles.length; j++) {
      const u = this.tiles[j];
      if (u.team !== t.team) continue;
      const dq = u.q - t.q, dr = u.r - t.r;
      if ((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2 <= radius) out.push(j);
    }
    return out;
  }

  // ---------------------------------------------------------------- outline for mesh building
  // Perimeter as a list of columns {x, z, nx, nz, r, end}: rounded-polygon outline points with
  // outward normals and the local fillet radius. Goal-mouth edges get exact columns at the posts.
  outline(step = 1.2) {
    const inn = this.inner, n = inn.length, cols = [];
    const push = (x, z, nx, nz, endWall) => {
      const side = this.isRect ? nx * nx : 1;
      cols.push({ x, z, nx, nz, r: this.isRect ? this.wallCurveFor(side) : this.rSide, endWall });
    };
    for (let i = 0; i < n; i++) {
      const [ax, az] = inn[i], [bx, bz] = inn[(i + 1) % n];
      const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
      const nx = ez / len, nz = -ex / len; // outward normal for a CCW polygon
      // straight edge from a to b, offset by Rc
      const ts = [0];
      if (this.mode === 'soccar' && Math.abs(nz) > 0.99) {
        for (const gx of [-this.goalHalfW, this.goalHalfW]) { const t = (gx - ax) / (ex || 1e-9); if (t > 0 && t < 1) ts.push(t); }
      }
      const m = Math.max(1, Math.round(len / step));
      for (let k = 1; k < m; k++) ts.push(k / m);
      ts.sort((p, q) => p - q);
      for (const t of ts) push(ax + ex * t + nx * this.Rc, az + ez * t + nz * this.Rc, nx, nz, Math.abs(nz) > 0.99);
      // corner arc around b, from this edge's normal to the next edge's normal
      const [cx, cz] = inn[(i + 2) % n];
      const fx = cx - bx, fz = cz - bz, fl = Math.hypot(fx, fz);
      const mx = fz / fl, mz = -fx / fl;
      const a0 = Math.atan2(nz, nx); let a1 = Math.atan2(mz, mx);
      while (a1 < a0) a1 += Math.PI * 2;
      const steps = Math.max(2, Math.round(((a1 - a0) * this.Rc) / step));
      for (let k = 0; k < steps; k++) {
        const ang = a0 + ((a1 - a0) * k) / steps;
        const cxn = Math.cos(ang), czn = Math.sin(ang);
        push(bx + cxn * this.Rc, bz + czn * this.Rc, cxn, czn, false);
      }
    }
    return cols;
  }
}

// Convex polygon (CCW) inset by d: offset every edge inwards and intersect neighbours.
function insetPolygon(poly, d) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const [px, pz] = poly[(i + n - 1) % n], [cx, cz] = poly[i], [nx, nz] = poly[(i + 1) % n];
    const e1x = cx - px, e1z = cz - pz, l1 = Math.hypot(e1x, e1z);
    const e2x = nx - cx, e2z = nz - cz, l2 = Math.hypot(e2x, e2z);
    // inward normals for CCW: (-ez, ex)
    const n1x = -e1z / l1, n1z = e1x / l1, n2x = -e2z / l2, n2z = e2x / l2;
    const k = d / (1 + n1x * n2x + n1z * n2z);
    out.push([cx + (n1x + n2x) * k, cz + (n1z + n2z) * k]);
  }
  return out;
}

// Exact signed distance to a polygon (negative inside).
function sdPolygon(v, x, z) {
  let d = (x - v[0][0]) ** 2 + (z - v[0][1]) ** 2, s = 1;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i++) {
    const ex = v[j][0] - v[i][0], ez = v[j][1] - v[i][1];
    const wx = x - v[i][0], wz = z - v[i][1];
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const bx = wx - ex * t, bz = wz - ez * t;
    d = Math.min(d, bx * bx + bz * bz);
    const c1 = z >= v[i][1], c2 = z < v[j][1], c3 = ex * wz > ez * wx;
    if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s;
  }
  return s * Math.sqrt(d);
}

// Designed boost layout: mirrored across both axes. Large pads at the mid-side lanes and in
// the attacking corners (rotation fuel); small pads trace the rotation lanes, the midfield
// challenge zone and the back-post recovery paths.
function buildPadLayout(arena) {
  const sx = arena.halfW / 35, sz = arena.halfL / 48;
  const pads = [];
  const add = (x, z, large) => pads.push({ x: x * sx, y: 0, z: z * sz, large, id: pads.length });
  add(-29, 0, true); add(29, 0, true);
  for (const z of [-37, 37]) { add(-27, z, true); add(27, z, true); }
  add(-12, 0, false); add(12, 0, false);
  for (const z of [-10, 10]) { add(0, z, false); add(-20, z, false); add(20, z, false); }
  for (const z of [-22, 22]) { add(-8, z, false); add(8, z, false); add(-30, z, false); add(30, z, false); }
  for (const z of [-32, 32]) { add(0, z, false); add(-16, z, false); add(16, z, false); }
  if (arena.mode === 'soccar') for (const z of [-43, 43]) { add(-10, z, false); add(10, z, false); }
  else for (const z of [-41, 41]) { add(-14, z, false); add(14, z, false); }
  for (const p of pads) {
    const cfg = p.large ? BOOST_PADS.large : BOOST_PADS.small;
    p.amount = cfg.amount; p.respawn = cfg.respawn; p.radius = cfg.radius; p.height = cfg.height;
  }
  return pads;
}
