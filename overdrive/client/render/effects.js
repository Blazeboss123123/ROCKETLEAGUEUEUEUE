// GPU particle pool (one draw call) for boost trails, impacts, pickups and goal explosions.
import * as THREE from 'three';

const VS = `
attribute float size; attribute float alpha; attribute float shape; attribute vec3 color;
varying float vAlpha; varying vec3 vColor; varying float vShape;
uniform float pixelScale;
void main(){
  vAlpha = alpha; vColor = color; vShape = shape;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
varying float vAlpha; varying vec3 vColor; varying float vShape;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float a;
  if (vShape > 0.5) { a = step(max(abs(p.x), abs(p.y)), 0.42); }
  else { float d = length(p); a = smoothstep(0.5, 0.0, d); a *= a; }
  if (a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor * (1.0 + vShape * 0.2), a * vAlpha);
}`;

export const TRAILS = {
  ion: { rate: 90, life: 0.38, size: [0.22, 0.05], colors: [0x7dd3fc, 0x2563eb], spread: 0.05, speed: 2, gravity: 0 },
  ember: { rate: 90, life: 0.5, size: [0.2, 0.06], colors: [0xfde047, 0xf97316, 0xdc2626], spread: 0.15, speed: 3, gravity: -4 },
  arc: { rate: 110, life: 0.25, size: [0.14, 0.08], colors: [0xffffff, 0x67e8f9, 0xa78bfa], spread: 0.35, speed: 4, gravity: 0, jitter: 6 },
  vapour: { rate: 50, life: 0.9, size: [0.2, 0.75], colors: [0xe5e7eb, 0x9ca3af], spread: 0.1, speed: 1, gravity: 0.6, alpha: 0.45, normal: true },
  prism: { rate: 70, life: 0.55, size: [0.16, 0.04], colors: [0xf472b6, 0x60a5fa, 0x34d399, 0xfacc15], spread: 0.2, speed: 2, gravity: 0, shape: 1 },
  aurora: { rate: 90, life: 0.7, size: [0.25, 0.08], colors: [0x34d399, 0x22d3ee, 0xa78bfa], spread: 0.1, speed: 1.5, gravity: 0.4, wave: 1 },
};

export class Particles {
  constructor(scene, capacity = 4000) {
    this.cap = capacity;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('shape', new THREE.BufferAttribute(this.shape, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: { pixelScale: { value: 600 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.normalMat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, uniforms: this.mat.uniforms, transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    // smoke uses a second pool with normal blending
    this.p = []; // particle structs
    this.scale = 1;
    this.tmpC = new THREE.Color();
  }

  setPixelScale(h) { this.mat.uniforms.pixelScale.value = h * 0.9; }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, color, alpha = 1, shape = 0, gravity = 0, extra = null) {
    if (this.p.length >= this.cap) return;
    this.p.push({ x, y, z, vx, vy, vz, life, max: life, s0, s1, color, alpha, shape, gravity, extra });
  }

  // emit a boost trail puff behind a car
  trail(styleId, x, y, z, dirx, diry, dirz, carVx, carVy, carVz, dt, t) {
    const st = TRAILS[styleId] || TRAILS.ion;
    const count = st.rate * dt * this.scale;
    let n = Math.floor(count) + (Math.random() < count % 1 ? 1 : 0);
    while (n-- > 0) {
      const c = st.colors[Math.floor(Math.random() * st.colors.length)];
      const sp = st.spread;
      let vx = -dirx * st.speed + (Math.random() - 0.5) * sp * 8, vy = -diry * st.speed + (Math.random() - 0.5) * sp * 8, vz = -dirz * st.speed + (Math.random() - 0.5) * sp * 8;
      vx += carVx * 0.15; vy += carVy * 0.15; vz += carVz * 0.15;
      this.spawn(x + (Math.random() - 0.5) * sp, y + (Math.random() - 0.5) * sp, z + (Math.random() - 0.5) * sp, vx, vy, vz,
        st.life * (0.7 + Math.random() * 0.6), st.size[0], st.size[1], c, st.alpha ?? 1, st.shape || 0, st.gravity, st.jitter ? { jitter: st.jitter } : st.wave ? { wave: t } : null);
    }
  }

  burst(x, y, z, n, speed, life, size, colors, opts = {}) {
    n = Math.floor(n * this.scale);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      let vx = r * Math.cos(th) * s, vy = u * s, vz = r * Math.sin(th) * s;
      if (opts.up) vy = Math.abs(vy) + opts.up;
      if (opts.flat) vy *= 0.15;
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.spawn(x, y, z, vx, vy, vz, life * (0.6 + Math.random() * 0.6), size, opts.endSize ?? size * 0.2, c, opts.alpha ?? 1, opts.shape || 0, opts.gravity || 0);
    }
  }

  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      if (p.extra?.jitter) { p.vx += (Math.random() - 0.5) * p.extra.jitter; p.vz += (Math.random() - 0.5) * p.extra.jitter; p.vy += (Math.random() - 0.5) * p.extra.jitter; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy = Math.abs(p.vy) * 0.3; }
      p.vx *= 1 - 1.5 * dt; p.vz *= 1 - 1.5 * dt;
      P[w++] = p;
    }
    P.length = w;
    const n = Math.min(w, this.cap);
    const c = this.tmpC;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      const t = 1 - p.life / p.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      c.set(p.color);
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.size[i] = p.s0 + (p.s1 - p.s0) * t;
      this.alpha[i] = p.alpha * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      this.shape[i] = p.shape;
    }
    this.geo.setDrawRange(0, n);
    for (const k of ['position', 'color', 'size', 'alpha', 'shape']) this.geo.attributes[k].needsUpdate = true;
  }

  clear() { this.p.length = 0; }
}

// Expanding ring used for shockwaves and impacts.
export class Rings {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.geo = new THREE.RingGeometry(0.9, 1, 48);
  }
  add(pos, normal, color, maxR, life) {
    const m = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.position.copy(pos);
    m.lookAt(pos.clone().add(normal));
    this.scene.add(m);
    this.list.push({ m, t: 0, life, maxR });
  }
  update(dt) {
    this.list = this.list.filter((r) => {
      r.t += dt;
      const k = r.t / r.life;
      if (k >= 1) { this.scene.remove(r.m); r.m.material.dispose(); return false; }
      const s = 0.2 + r.maxR * (1 - (1 - k) * (1 - k));
      r.m.scale.setScalar(s);
      r.m.material.opacity = 0.9 * (1 - k);
      return true;
    });
  }
}

export function goalExplosion(fx, rings, flash, styleId, pos, teamColor) {
  const tc = [teamColor.main, teamColor.light, 0xffffff];
  if (styleId === 'burst') {
    fx.burst(pos.x, pos.y, pos.z, 260, 26, 1.4, 0.7, tc, { endSize: 0.1 });
    fx.burst(pos.x, pos.y, pos.z, 80, 10, 2.0, 1.2, [0xffffff], { endSize: 0.2, alpha: 0.6 });
  } else if (styleId === 'cubes') {
    fx.burst(pos.x, pos.y, pos.z, 320, 18, 1.8, 0.55, [...tc, 0xfacc15, 0xf472b6], { shape: 1, gravity: -9, up: 6, endSize: 0.3 });
  } else if (styleId === 'nova') {
    fx.burst(pos.x, pos.y, pos.z, 400, 34, 1.2, 0.9, tc, { endSize: 0.05 });
    fx.burst(pos.x, pos.y, pos.z, 120, 6, 2.5, 2.4, [teamColor.light], { alpha: 0.35, endSize: 3 });
    rings.add(pos, new THREE.Vector3(0, 1, 0), teamColor.light, 26, 1.0);
  } else {
    fx.burst(pos.x, pos.y, pos.z, 180, 20, 1.1, 0.6, tc, { endSize: 0.1 });
  }
  rings.add(pos, new THREE.Vector3(0, 0, 1), teamColor.main, 18, 0.8);
  rings.add(pos, new THREE.Vector3(0, 1, 0), 0xffffff, 12, 0.6);
  if (flash) { flash.color.set(teamColor.main); flash.position.copy(pos); flash.intensity = 400; }
}
