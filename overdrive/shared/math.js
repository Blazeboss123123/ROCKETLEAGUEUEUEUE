// Small allocation-conscious vector / quaternion helpers used by the simulation.
// Methods mutate `this` and return it, so chains avoid temporary objects.

export class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  scale(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaled(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    this.x = x; this.y = y; this.z = z; return this;
  }
  len() { return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z); }
  lenSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  norm() { const l = this.len(); if (l > 1e-9) { this.x /= l; this.y /= l; this.z /= l; } return this; }
  clampLen(max) { const l = this.len(); if (l > max) this.scale(max / l); return this; }
  dist(v) { const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
  // remove the component along unit vector n
  reject(n) { const d = this.dot(n); this.x -= n.x * d; this.y -= n.y * d; this.z -= n.z * d; return this; }
  applyQuat(q) {
    const x = this.x, y = this.y, z = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return this;
  }
}

export class Quat {
  constructor(x = 0, y = 0, z = 0, w = 1) { this.x = x; this.y = y; this.z = z; this.w = w; }
  set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; return this; }
  copy(q) { this.x = q.x; this.y = q.y; this.z = q.z; this.w = q.w; return this; }
  clone() { return new Quat(this.x, this.y, this.z, this.w); }
  norm() {
    let l = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);
    if (!(l > 1e-9)) { this.set(0, 0, 0, 1); return this; }
    l = 1 / l; this.x *= l; this.y *= l; this.z *= l; this.w *= l; return this;
  }
  setAxisAngle(ax, angle) {
    const h = angle / 2, s = Math.sin(h);
    this.x = ax.x * s; this.y = ax.y * s; this.z = ax.z * s; this.w = Math.cos(h); return this;
  }
  // this = a * b
  multiplyQuats(a, b) {
    const ax = a.x, ay = a.y, az = a.z, aw = a.w, bx = b.x, by = b.y, bz = b.z, bw = b.w;
    this.x = ax * bw + aw * bx + ay * bz - az * by;
    this.y = ay * bw + aw * by + az * bx - ax * bz;
    this.z = az * bw + aw * bz + ax * by - ay * bx;
    this.w = aw * bw - ax * bx - ay * by - az * bz;
    return this;
  }
  // integrate world-space angular velocity w over dt
  integrate(w, dt) {
    const wx = w.x * dt * 0.5, wy = w.y * dt * 0.5, wz = w.z * dt * 0.5;
    const x = this.x, y = this.y, z = this.z, qw = this.w;
    this.x += wx * qw + wy * z - wz * y;
    this.y += wy * qw + wz * x - wx * z;
    this.z += wz * qw + wx * y - wy * x;
    this.w += -wx * x - wy * y - wz * z;
    return this.norm();
  }
  // rotation that takes the car's local frame to look along fwd with the given up
  setFromBasis(fwd, up) {
    // columns: left = up x fwd, up, fwd
    const lx = up.y * fwd.z - up.z * fwd.y, ly = up.z * fwd.x - up.x * fwd.z, lz = up.x * fwd.y - up.y * fwd.x;
    const m00 = lx, m01 = up.x, m02 = fwd.x;
    const m10 = ly, m11 = up.y, m12 = fwd.y;
    const m20 = lz, m21 = up.z, m22 = fwd.z;
    const tr = m00 + m11 + m22;
    if (tr > 0) {
      const s = 0.5 / Math.sqrt(tr + 1);
      this.w = 0.25 / s; this.x = (m21 - m12) * s; this.y = (m02 - m20) * s; this.z = (m10 - m01) * s;
    } else if (m00 > m11 && m00 > m22) {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      this.w = (m21 - m12) / s; this.x = 0.25 * s; this.y = (m01 + m10) / s; this.z = (m02 + m20) / s;
    } else if (m11 > m22) {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      this.w = (m02 - m20) / s; this.x = (m01 + m10) / s; this.y = 0.25 * s; this.z = (m12 + m21) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
      this.w = (m10 - m01) / s; this.x = (m02 + m20) / s; this.y = (m12 + m21) / s; this.z = 0.25 * s;
    }
    return this.norm();
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : 1);
export const round = (v, p) => Math.round(v * p) / p;

// Deterministic PRNG (mulberry32) so kickoff choices replicate exactly.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
