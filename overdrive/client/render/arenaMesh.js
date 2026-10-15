// Builds the visible arena from the same parameters as the collision SDF:
// the bowl (any rounded convex plan, per-wall fillet radius), the floor and its markings,
// mode furniture (Soccar goals, Hoops rims/nets/backboards, Dropshot hex tiles) and a themed
// world around it (stands, light towers, screens, city, water, mountains, dunes, space).
import * as THREE from 'three';
import { TEAM_COLORS, HOOPS, DROPSHOT, ARENA_VARIANTS } from '../../shared/config.js';
import { mergeByMaterial } from './merge.js';

const V = (id) => ARENA_VARIANTS[id] || {};
// Each arena variant has a theme with the same id. `sky` is a gradient dome; `surround` lists
// what is built around the bowl.
export const ARENA_THEMES = {
  stadium: {
    look: { bloom: 0.85, threshold: 0.9, exposure: 1.25, saturation: 1.15, contrast: 1.06 },
    name: V('stadium').name, blurb: 'Night-time championship bowl under light towers. The competitive standard.',
    sky: { top: 0x01030a, horizon: 0x101b3a, bottom: 0x020308 }, fog: 0x0b1328, fogRange: [140, 520],
    floor: '#1b3a31', floor2: '#18332c', line: 'rgba(235,245,255,0.85)', wall: [140, 175, 220], wallAlpha: [0.6, 0.1],
    hemi: [0x9fb8ff, 0x0d0f18, 0.75], sun: [0xffffff, 1.6], sunPos: [30, 80, 20], accent: 0x7dd3fc, ground: 0x0a0e16,
    standColor: 0x151c2c, roofColor: 0x0f1522, surround: ['stands', 'roof', 'towers', 'screens'],
  },
  solstice: {
    look: { bloom: 0.45, threshold: 1.6, exposure: 1.08, saturation: 1.1, contrast: 1.05, vignette: 0.35 },
    name: V('solstice').name, blurb: 'Open-air afternoon park with tree lines and warm light.',
    sky: { top: 0x3f8fdc, horizon: 0xd6ebf7, bottom: 0x6d8f5e, sun: [0.45, 0.55, -0.7], sunColor: 0xfff1d6, sunSize: 1 }, fog: 0xc9e0ef, fogRange: [160, 620],
    floor: '#3f7f3b', floor2: '#397536', line: 'rgba(255,255,255,0.92)', wall: [235, 245, 255], wallAlpha: [0.5, 0.06],
    hemi: [0xdfefff, 0x4a5a3a, 1.0], sun: [0xfff2dd, 2.3], sunPos: [40, 70, -50], accent: 0xffffff, ground: 0x4c7a3c,
    standColor: 0xc9ced6, roofColor: 0xe5e7eb, surround: ['stands', 'screens', 'trees'],
  },
  harbor: {
    look: { bloom: 1.1, threshold: 0.75, exposure: 1.3, saturation: 1.22, contrast: 1.1 },
    name: V('harbor').name, blurb: 'Neon waterfront at night. Skyline, reflections and magenta haze.',
    sky: { top: 0x05010f, horizon: 0x4a1250, bottom: 0x05020c }, fog: 0x1d0b2c, fogRange: [150, 640],
    floor: '#161b33', floor2: '#13182d', line: 'rgba(120,240,255,0.95)', wall: [255, 70, 200], wallAlpha: [0.62, 0.12], wallStyle: 'hex',
    hemi: [0xd6b8ff, 0x10061c, 0.85], sun: [0xc4b5fd, 1.2], sunPos: [-30, 70, 30], accent: 0xff3ea5,
    standColor: 0x1a1430, roofColor: 0x120d22, tiers: 4, surround: ['stands', 'city', 'water', 'towers'], city: { near: 130, far: 320, hMin: 25, hMax: 130, glow: 0xff9df0 },
  },
  frostbite: {
    look: { bloom: 0.5, threshold: 1.5, exposure: 0.95, saturation: 1.0, contrast: 1.05, vignette: 0.35 },
    name: V('frostbite').name, blurb: 'Alpine bowl in falling snow, ringed by pines and peaks.',
    sky: { top: 0x7aa2cf, horizon: 0xe8eff7, bottom: 0xdfe8f0, sun: [-0.3, 0.35, 0.9], sunColor: 0xffffff, sunSize: 0.6 }, fog: 0xdbe6f0, fogRange: [120, 600],
    floor: '#2f6458', floor2: '#2b5c51', line: 'rgba(255,255,255,0.95)', wall: [210, 235, 255], wallAlpha: [0.55, 0.08],
    hemi: [0xeaf4ff, 0x5b6b7a, 1.05], sun: [0xf4f8ff, 1.7], sunPos: [-30, 60, 70], accent: 0xbae6fd, ground: 0xe9f0f6,
    standColor: 0x5b6b7c, roofColor: 0xf1f5f9, surround: ['stands', 'roof', 'mountains', 'pines', 'snow'],
  },
  mirage: {
    look: { bloom: 0.75, threshold: 1.2, exposure: 1.1, saturation: 1.18, contrast: 1.08 },
    name: V('mirage').name, blurb: 'Desert arena at sunset among dunes and red mesas.',
    sky: { top: 0x23285e, horizon: 0xff9348, bottom: 0xb86a3a, sun: [0.2, 0.06, -0.98], sunColor: 0xffb070, sunSize: 2.2 }, fog: 0xe9935a, fogRange: [170, 700],
    floor: '#5d6d2f', floor2: '#56652b', line: 'rgba(255,248,235,0.92)', wall: [255, 205, 150], wallAlpha: [0.55, 0.08],
    hemi: [0xffd7a8, 0x5a3420, 0.95], sun: [0xffb37a, 2.4], sunPos: [10, 25, -80], accent: 0xffc285, ground: 0xd29a5e,
    standColor: 0xa9825a, roofColor: 0xc8a174, surround: ['stands', 'dunes', 'mesas'],
  },
  skyway: {
    look: { bloom: 1.0, threshold: 0.8, exposure: 1.2, saturation: 1.15, contrast: 1.08 },
    name: V('skyway').name, blurb: 'Casual-only: wider, taller and rounder, floating above the clouds at dusk.',
    sky: { top: 0x0f0820, horizon: 0x5b2a7a, bottom: 0x1a0f2c }, fog: 0x24123a, fogRange: [150, 650],
    floor: '#24183a', floor2: '#201536', line: 'rgba(240,220,255,0.88)', wall: [190, 150, 255], wallAlpha: [0.5, 0.08],
    hemi: [0xd9c6ff, 0x120a1f, 0.85], sun: [0xf5e6ff, 1.3], sunPos: [30, 80, 20], accent: 0xc084fc, surround: ['skyring', 'stars', 'clouds'],
  },
  court: {
    look: { bloom: 0.7, threshold: 1.1, exposure: 1.12, saturation: 1.12, contrast: 1.08 },
    name: V('court').name, blurb: 'Hoops: indoor-style hardwood court in a city plaza at dusk.',
    sky: { top: 0x161a3a, horizon: 0xf0875a, bottom: 0x1a1426, sun: [0.6, 0.08, 0.8], sunColor: 0xffa060, sunSize: 1.4 }, fog: 0x5a3a4a, fogRange: [140, 560],
    floorStyle: 'wood', floor: '#b9824a', floor2: '#ab7742', line: 'rgba(255,255,255,0.95)', wall: [255, 255, 255], wallAlpha: [0.5, 0.07],
    hemi: [0xffe0c8, 0x2a1c26, 0.95], sun: [0xffc59a, 1.9], sunPos: [50, 40, 60], accent: 0xffa94d, ground: 0x2b2a33,
    standColor: 0x2a2f3d, roofColor: 0x1c2130, tiers: 4, surround: ['stands', 'city', 'towers'], city: { near: 130, far: 300, hMin: 18, hMax: 85, glow: 0xffd28a },
  },
  hexcore: {
    look: { bloom: 1.2, threshold: 0.75, exposure: 1.25, saturation: 1.2, contrast: 1.1 },
    name: V('hexcore').name, blurb: 'Dropshot: hexagonal reactor arena in orbit. Break the floor to score.',
    sky: { top: 0x010108, horizon: 0x0b1a3f, bottom: 0x000004 }, fog: 0x060b1c, fogRange: [180, 700],
    floor: '#0e1424', floor2: '#0c1120', line: 'rgba(120,220,255,0.8)', wall: [90, 220, 255], wallAlpha: [0.6, 0.1], wallStyle: 'hex',
    hemi: [0xbfe7ff, 0x05060c, 0.85], sun: [0xe0f2ff, 1.5], sunPos: [-40, 80, 30], accent: 0x5eead4, surround: ['skyring', 'stars', 'planet'],
  },
};
for (const [id, t] of Object.entries(ARENA_THEMES)) t.id = id;

// ------------------------------------------------------------------ textures
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c, { repeat = false, srgb = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

function wallTexture(theme) {
  const [c, g] = canvas(256, 256);
  const [r, gg, b] = theme.wall;
  g.fillStyle = `rgba(${r},${gg},${b},0.16)`; g.fillRect(0, 0, 256, 256);
  if (theme.wallStyle === 'hex') {
    g.strokeStyle = `rgba(${r},${gg},${b},0.7)`; g.lineWidth = 2.5;
    const R = 32, w = R * Math.sqrt(3);
    for (let row = -1; row < 6; row++) for (let col = -1; col < 6; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0), cy = row * R * 1.5;
      g.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
      g.closePath(); g.stroke();
    }
  } else {
    g.strokeStyle = `rgba(${r},${gg},${b},0.8)`; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 253);
    g.strokeStyle = `rgba(${r},${gg},${b},0.22)`; g.lineWidth = 1;
    for (let i = 32; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  }
  return tex(c, { repeat: true });
}

function netTexture(color) {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = color; g.lineWidth = 2.5; g.globalAlpha = 0.9;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i - 64, 128); g.stroke(); g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 128); g.stroke(); }
  return tex(c, { repeat: true });
}

// ------------------------------------------------------------------ floor markings
function floorTexture(arena, theme, colors) {
  const a = arena.halfW, b = arena.halfL;
  const W = 1024, Hh = Math.round((1024 * b) / a);
  const [c, g] = canvas(W, Hh);
  const sx = W / (2 * a), sz = Hh / (2 * b);
  const X = (x) => (x + a) * sx, Z = (z) => (b - z) * sz; // +z (orange) at the top of the texture
  const M = (m) => m * sx;
  const tint = (col, z0, z1, alpha = '30') => { const grd = g.createLinearGradient(0, Z(z0), 0, Z(z1)); grd.addColorStop(0, col + '00'); grd.addColorStop(1, col + alpha); g.fillStyle = grd; g.fillRect(0, Math.min(Z(z0), Z(z1)), W, Math.abs(Z(z1) - Z(z0))); };
  const circle = (x, z, r, fill) => { g.beginPath(); g.arc(X(x), Z(z), M(r), 0, Math.PI * 2); if (fill) g.fill(); else g.stroke(); };

  if (arena.mode === 'hoops') {
    // hardwood planks
    g.fillStyle = theme.floor; g.fillRect(0, 0, W, Hh);
    const plank = M(0.55);
    for (let y = 0, k = 0; y < Hh; y += plank, k++) {
      g.fillStyle = k % 3 === 0 ? theme.floor2 : k % 3 === 1 ? theme.floor : '#b07c45';
      g.fillRect(0, y, W, plank - 1);
      g.fillStyle = 'rgba(60,30,10,0.35)'; g.fillRect(0, y + plank - 1, W, 1);
      for (let x = ((k * 97) % 160) - 160; x < W; x += 160 + ((k * 31) % 60)) g.fillRect(x, y, 1.5, plank);
    }
    g.fillStyle = 'rgba(255,240,220,0.06)'; g.fillRect(0, 0, W, Hh);
    tint(colors[1].css, 0, b, '28'); tint(colors[0].css, 0, -b, '28');
    g.strokeStyle = theme.line; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(W, Z(0)); g.stroke();
    circle(0, 0, 7); g.lineWidth = 4; circle(0, 0, 2.5);
    for (const team of [0, 1]) {
      const s = team ? 1 : -1, hz = s * arena.hoopZ, col = colors[team].css;
      // key (painted lane) in team colour
      const kw = 5.2, kl = 13;
      g.fillStyle = col + '70';
      g.fillRect(X(-kw), Math.min(Z(s * b), Z(s * (b - kl))), M(2 * kw), M(kl));
      g.strokeStyle = theme.line; g.lineWidth = 5;
      g.strokeRect(X(-kw), Math.min(Z(s * b), Z(s * (b - kl))), M(2 * kw), M(kl));
      circle(0, s * (b - kl), kw);
      // three-point arc around the rim
      g.save(); g.beginPath(); g.rect(0, s > 0 ? 0 : Z(0), W, Hh / 2); g.clip();
      g.lineWidth = 6; circle(0, hz, 17); g.restore();
      // hoop shadow ring under the rim
      g.strokeStyle = col; g.lineWidth = 4; circle(0, hz, HOOPS.rimRadius);
    }
  } else if (arena.mode === 'dropshot') {
    const grd = g.createRadialGradient(W / 2, Hh / 2, 10, W / 2, Hh / 2, Hh * 0.7);
    grd.addColorStop(0, '#16203a'); grd.addColorStop(1, theme.floor);
    g.fillStyle = grd; g.fillRect(0, 0, W, Hh);
    tint(colors[1].css, 0, b, '40'); tint(colors[0].css, 0, -b, '40');
    // glowing halfway line between the two tile fields
    const lg = g.createLinearGradient(0, Z(0) - 18, 0, Z(0) + 18);
    lg.addColorStop(0, 'rgba(120,220,255,0)'); lg.addColorStop(0.5, 'rgba(200,245,255,0.95)'); lg.addColorStop(1, 'rgba(120,220,255,0)');
    g.fillStyle = lg; g.fillRect(0, Z(0) - 18, W, 36);
  } else {
    for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? theme.floor : theme.floor2; g.fillRect(0, (Hh / 16) * i, W, Hh / 16 + 1); }
    // diagonal mowing pattern
    g.fillStyle = 'rgba(255,255,255,0.025)';
    for (let i = -Hh; i < W; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 32, 0); g.lineTo(i + 32 + Hh, Hh); g.lineTo(i + Hh, Hh); g.fill(); }
    tint(colors[1].css, 0, b); tint(colors[0].css, 0, -b);
    g.strokeStyle = theme.line; g.lineWidth = 6;
    g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(W, Z(0)); g.stroke();
    circle(0, 0, 10);
    g.fillStyle = theme.line; g.beginPath(); g.arc(X(0), Z(0), 9, 0, Math.PI * 2); g.fill();
    const gw = arena.goalHalfW;
    for (const s of [1, -1]) {
      g.strokeStyle = theme.line; g.lineWidth = 5;
      g.strokeRect(X(-gw - 4), Math.min(Z(s * b), Z(s * (b - 9))), (2 * gw + 8) * sx, 9 * sz);
      g.beginPath(); g.arc(X(0), Z(s * (b - 9)), 6 * sx, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2); g.stroke();
      g.strokeStyle = colors[s > 0 ? 1 : 0].css; g.lineWidth = 10;
      g.beginPath(); g.moveTo(X(-gw), Z(s * b)); g.lineTo(X(gw), Z(s * b)); g.stroke();
    }
  }
  // kickoff spawn markers
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const team of [0, 1]) for (const sp of arena.kickoffSpawns(team, 5, () => 0)) { g.beginPath(); g.arc(X(sp.pos.x), Z(sp.pos.z), 7, 0, Math.PI * 2); g.fill(); }
  return tex(c, { aniso: 8 });
}

// ------------------------------------------------------------------ bowl
// Per-column profile: floor fillet (column's own radius), straight wall rows shared by every
// column, ceiling fillet. Every column has the same number of rows, so the shell is a grid.
function profileFor(r, wallYs, H, K) {
  const rows = [];
  for (let i = 0; i <= K; i++) { const th = (Math.PI / 2) * i / K; rows.push({ d: r - r * Math.sin(th), y: r - r * Math.cos(th) }); }
  for (const y of wallYs) rows.push({ d: 0, y });
  for (let i = 0; i <= K; i++) { const th = (Math.PI / 2) * i / K; rows.push({ d: r - r * Math.cos(th), y: H - r + r * Math.sin(th) }); }
  let v = 0;
  rows.forEach((row, i) => { if (i) v += Math.hypot(row.d - rows[i - 1].d, row.y - rows[i - 1].y); row.v = v; });
  return rows;
}

function buildBowl(arena, theme, colors) {
  const p = arena.p, H = p.height, gh = p.goalHeight, gw = arena.goalHalfW;
  const soccar = arena.mode === 'soccar';
  const cols = arena.outline(1.2);
  const NC = cols.length, K = 8;
  const rMax = Math.max(arena.rSide, arena.rEnd);
  const lo = rMax, hi = H - rMax;
  const wallYs = [];
  const n = Math.max(2, Math.round((hi - lo) / 1.6));
  for (let k = 1; k < n; k++) wallYs.push(lo + ((hi - lo) * k) / n);
  if (soccar && gh > lo + 0.05 && gh < hi - 0.05) { wallYs.push(gh); wallYs.sort((x, y) => x - y); }
  const mouth = (c) => soccar && c.endWall && Math.abs(c.x) <= gw + 1e-6;
  const profiles = cols.map((c) => profileFor(c.r, wallYs, H, K));
  const NR = profiles[0].length;
  let u = 0;
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i < NC; i++) {
    const c = cols[i];
    if (i) u += Math.hypot(c.x - cols[i - 1].x, c.z - cols[i - 1].z);
    for (const row of profiles[i]) {
      pos.push(c.x - c.nx * row.d, row.y, c.z - c.nz * row.d);
      uv.push(u / 6, row.v / 6);
      const t = Math.min(1, Math.max(0, (row.y - 1) / (H * 0.6)));
      const a0 = Math.min(0.88, theme.wallAlpha[0] + 0.16), a1 = theme.wallAlpha[1] + 0.1;
      col.push(1, 1, 1, a0 + (a1 - a0) * t);
    }
  }
  const vtx = (i, j) => (i % NC) * NR + j;
  for (let i = 0; i < NC; i++) {
    const i2 = (i + 1) % NC;
    for (let j = 0; j < NR - 1; j++) {
      // cut the goal mouth (and the floor fillet in front of it) out of the end walls
      if (mouth(cols[i]) && mouth(cols[i2]) && profiles[i][j + 1].y <= gh + 1e-6) continue;
      idx.push(vtx(i, j), vtx(i2, j), vtx(i, j + 1), vtx(i2, j), vtx(i2, j + 1), vtx(i, j + 1));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const shellMat = new THREE.MeshStandardMaterial({
    map: wallTexture(theme), transparent: true, vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.1,
    depthWrite: false, emissive: new THREE.Color(theme.accent), emissiveIntensity: 0.06,
  });
  // glass reads more solid at grazing angles (fresnel), so walls are clear when driving on them
  shellMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>',
      'float fres = pow(1.0 - abs(dot(normalize(normal), normalize(vViewPosition))), 3.0);\n diffuseColor.a = min(0.96, diffuseColor.a * (1.0 + fres * 2.2) + fres * 0.08);\n #include <opaque_fragment>');
  };
  const shell = new THREE.Mesh(geo, shellMat);
  shell.renderOrder = 2;

  // glowing trim where the floor fillet meets the wall, blue at one end fading to orange at the other
  const trim = (yOf, height, dIn) => {
    const tp = [], tc = [], ti = [];
    const cb = new THREE.Color(colors[0].main), co = new THREE.Color(colors[1].main), cw = new THREE.Color(0xffffff), cc = new THREE.Color();
    for (let i = 0; i <= NC; i++) {
      const c = cols[i % NC], y0 = yOf(c);
      tp.push(c.x - c.nx * dIn, y0, c.z - c.nz * dIn, c.x - c.nx * dIn, y0 + height, c.z - c.nz * dIn);
      const k = Math.max(-1, Math.min(1, c.z / (arena.halfL * 0.7)));
      cc.copy(cw).multiplyScalar(0.55).lerp(k < 0 ? cb : co, Math.abs(k));
      tc.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b);
      if (i < NC && !(mouth(c) && mouth(cols[(i + 1) % NC]) && y0 < gh)) ti.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 2, 2 * i + 3, 2 * i + 1);
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));
    tg.setIndex(ti);
    return new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthWrite: false }));
  };
  const trims = [trim((c) => c.r + 0.15, 0.22, 0.03), trim((c) => H - c.r - 0.4, 0.18, 0.03)];

  // floor polygon: where each fillet starts (or the wall line inside the goal mouth)
  const shape = new THREE.Shape();
  const fp = [];
  for (let i = 0; i < NC; i++) {
    const c = cols[i], prev = cols[(i + NC - 1) % NC];
    const inner = soccar && c.endWall && Math.abs(c.x) < gw - 1e-6;
    const post = soccar && c.endWall && Math.abs(Math.abs(c.x) - gw) < 1e-6;
    const ptAt = (d) => [c.x - c.nx * d, c.z - c.nz * d];
    if (post) {
      const prevIn = prev.endWall && Math.abs(prev.x) < gw - 1e-6;
      if (prevIn) fp.push(ptAt(0), ptAt(c.r)); else fp.push(ptAt(c.r), ptAt(0));
    } else fp.push(ptAt(inner ? 0 : c.r));
  }
  fp.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  const a = arena.halfW, b = arena.halfL;
  const floorGeo = new THREE.ShapeGeometry(shape);
  floorGeo.rotateX(-Math.PI / 2);
  const fpa = floorGeo.attributes.position, fuv = floorGeo.attributes.uv;
  for (let i = 0; i < fpa.count; i++) fuv.setXY(i, (fpa.getX(i) + a) / (2 * a), (fpa.getZ(i) + b) / (2 * b));
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(arena, theme, colors), roughness: arena.mode === 'hoops' ? 0.45 : 0.85, metalness: arena.mode === 'dropshot' ? 0.4 : 0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;

  // ceiling (faint)
  const cshape = new THREE.Shape();
  cols.forEach((c, i) => { const x = c.x - c.nx * c.r, z = c.z - c.nz * c.r; if (i) cshape.lineTo(x, -z); else cshape.moveTo(x, -z); });
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(cshape).rotateX(-Math.PI / 2).translate(0, H, 0),
    new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));

  return { shell, shellMat, floor, floorMat, ceil, trims, cols };
}

// ------------------------------------------------------------------ Soccar goals
function filletCap(r, x, zWall, s, theme) {
  // the solid between the back-wall floor fillet and the wall corner, seen side-on at a post
  const pts = [], K = 9;
  for (let i = 0; i <= K; i++) { const th = (Math.PI / 2) * i / K; pts.push([r - r * Math.sin(th), r - r * Math.cos(th)]); }
  const verts = [x, 0, zWall];
  for (const [d, y] of pts) verts.push(x, y, zWall - s * d);
  const idx = [];
  for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.floor2), side: THREE.DoubleSide, roughness: 0.9 }));
}

function buildGoals(arena, theme, colors, group) {
  const p = arena.p, b = arena.halfL, gw = arena.goalHalfW, gh = p.goalHeight, depth = p.goalDepth;
  const z0 = arena.goalZ0;
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1, col = colors[team];
    const g = new THREE.Group();
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture(col.css), transparent: true, side: THREE.DoubleSide, emissive: new THREE.Color(col.main), emissiveIntensity: 0.25, depthWrite: false, roughness: 0.6 });
    netMat.map.repeat.set(4, 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, gh), netMat); back.position.set(0, gh / 2, s * (b + depth));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, depth), netMat); roof.rotation.x = Math.PI / 2; roof.position.set(0, gh, s * (b + depth / 2));
    const left = new THREE.Mesh(new THREE.PlaneGeometry(depth, gh), netMat); left.rotation.y = Math.PI / 2; left.position.set(-gw, gh / 2, s * (b + depth / 2));
    const right = left.clone(); right.position.x = gw;
    // goal floor runs from where the back-wall fillet would start, so the mouth is flush
    const flen = b + depth - z0;
    const gfloor = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, flen), new THREE.MeshStandardMaterial({ color: new THREE.Color(col.dark), roughness: 0.8, emissive: new THREE.Color(col.main), emissiveIntensity: 0.1 }));
    gfloor.rotation.x = -Math.PI / 2; gfloor.position.set(0, 0.004, s * (z0 + flen / 2));
    g.add(back, roof, left, right, gfloor);
    const frameMat = new THREE.MeshStandardMaterial({ color: col.light, emissive: new THREE.Color(col.main), emissiveIntensity: 1.6, roughness: 0.3 });
    const postGeo = new THREE.CylinderGeometry(0.22, 0.22, gh, 12);
    for (const x of [-gw, gw]) { const post = new THREE.Mesh(postGeo, frameMat); post.position.set(x, gh / 2, s * b); g.add(post); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2 * gw + 0.44, 12), frameMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, gh, s * b); g.add(bar);
    for (const x of [-gw, gw]) g.add(filletCap(arena.rEnd, x, s * b, s, theme));
    const light = new THREE.PointLight(col.main, 60, 40, 1.6); light.position.set(0, gh * 0.8, s * (b - 2)); light.userData.dynamic = true; g.add(light);
    mergeByMaterial(g);
    group.add(g);
  }
}

// ------------------------------------------------------------------ Hoops furniture
function backboardTexture(col) {
  const [c, g] = canvas(256, 160);
  const grd = g.createLinearGradient(0, 0, 0, 160);
  grd.addColorStop(0, 'rgba(255,255,255,0.28)'); grd.addColorStop(1, 'rgba(255,255,255,0.12)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 160);
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 8; g.strokeRect(4, 4, 248, 152);
  g.strokeStyle = col; g.lineWidth = 7; g.strokeRect(84, 62, 88, 64);
  return tex(c);
}

function buildHoops(arena, theme, colors, group) {
  const b = arena.halfL, rimY = arena.rimY;
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1, col = colors[team], z = s * arena.hoopZ;
    const g = new THREE.Group();
    const rimMat = new THREE.MeshStandardMaterial({ color: col.light, emissive: new THREE.Color(col.main), emissiveIntensity: 1.3, metalness: 0.6, roughness: 0.3 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(arena.rimR, HOOPS.rimTube, 12, 64), rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.set(0, rimY, z);
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture('#f8fafc'), transparent: true, side: THREE.DoubleSide, emissive: new THREE.Color(col.main), emissiveIntensity: 0.2, depthWrite: false });
    netMat.map.repeat.set(10, 2);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(arena.rimR, arena.rimR * 0.62, HOOPS.netDepth, 32, 3, true), netMat);
    net.position.set(0, rimY - HOOPS.netDepth / 2, z);
    // backboard on the back wall and the bracket holding the rim
    const bw = 2 * arena.rimR + 6, bh = 4.4;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bh), new THREE.MeshBasicMaterial({ map: backboardTexture(col.css), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    board.position.set(0, rimY + 1.6, s * (b - 0.08)); board.rotation.y = s > 0 ? Math.PI : 0;
    board.userData.dynamic = true;
    const blen = b - (arena.hoopZ + arena.rimR);
    const bracketMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.7, roughness: 0.35 });
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, blen + 0.2), bracketMat);
    bracket.position.set(0, rimY, s * (arena.hoopZ + arena.rimR + blen / 2));
    // glowing ring on the floor under the hoop
    const ring = new THREE.Mesh(new THREE.RingGeometry(arena.rimR - 0.25, arena.rimR + 0.05, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: col.main, transparent: true, opacity: 0.55, depthWrite: false }));
    ring.position.set(0, 0.012, z); ring.userData.dynamic = true;
    const light = new THREE.PointLight(col.main, 50, 30, 1.6); light.position.set(0, rimY + 3, z - s * 3); light.userData.dynamic = true;
    g.add(rim, net, board, bracket, ring, light);
    mergeByMaterial(g);
    group.add(g);
  }
}

// ------------------------------------------------------------------ Dropshot tiles
function tileTextures() {
  const S = 256, mid = S / 2;
  const hexPath = (g, r) => { g.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 2 + (i * Math.PI) / 3; g.lineTo(mid + Math.cos(a) * r, mid + Math.sin(a) * r); } g.closePath(); };
  // diffuse: brushed panel, lighter towards the rim
  const [c1, g1] = canvas(S, S);
  const rg = g1.createRadialGradient(mid, mid, 10, mid, mid, mid);
  rg.addColorStop(0, '#6b7280'); rg.addColorStop(0.75, '#9ca3af'); rg.addColorStop(1, '#d1d5db');
  g1.fillStyle = rg; g1.fillRect(0, 0, S, S);
  g1.strokeStyle = 'rgba(0,0,0,0.25)'; g1.lineWidth = 3; hexPath(g1, mid * 0.55); g1.stroke();
  // emissive: bright rim with a soft inner falloff and an inner hex line
  const [c2, g2] = canvas(S, S);
  g2.fillStyle = '#000'; g2.fillRect(0, 0, S, S);
  for (let k = 0; k < 10; k++) { g2.strokeStyle = `rgba(255,255,255,${0.09 * (10 - k) / 10})`; g2.lineWidth = 4; hexPath(g2, mid * 0.98 - k * 4); g2.stroke(); }
  g2.strokeStyle = '#fff'; g2.lineWidth = 6; hexPath(g2, mid * 0.97); g2.stroke();
  g2.strokeStyle = 'rgba(255,255,255,0.45)'; g2.lineWidth = 3; hexPath(g2, mid * 0.55); g2.stroke();
  // hole: black core, glowing edge
  const [c3, g3] = canvas(S, S);
  const hg = g3.createRadialGradient(mid, mid, 0, mid, mid, mid);
  hg.addColorStop(0, '#000'); hg.addColorStop(0.7, '#000'); hg.addColorStop(0.92, '#555'); hg.addColorStop(1, '#fff');
  g3.fillStyle = hg; g3.fillRect(0, 0, S, S);
  return { map: tex(c1), glow: tex(c2), hole: tex(c3) };
}

function buildTiles(arena, colors, group) {
  const R = DROPSHOT.tileRadius, tiles = arena.tiles, n = tiles.length;
  const T = tileTextures();
  const geo = new THREE.CylinderGeometry(R * 0.955, R * 0.955, 0.3, 6, 1, false, Math.PI / 2).translate(0, -0.15 + 0.012, 0);
  const mat = new THREE.MeshStandardMaterial({ map: T.map, emissive: 0xffffff, emissiveMap: T.glow, emissiveIntensity: 1, roughness: 0.35, metalness: 0.45 });
  // per-instance colour also tints the glow
  mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance *= vColor;\n#endif'); };
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.receiveShadow = true;
  const holeGeo = new THREE.CircleGeometry(R * 0.955, 6).rotateX(-Math.PI / 2);
  // CircleGeometry's uv is planar, so a radial texture reads as a dark pit with a lit edge
  const holes = new THREE.InstancedMesh(holeGeo, new THREE.MeshBasicMaterial({ map: T.hole }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  const intact = colors.map((cl) => new THREE.Color(cl.main).multiplyScalar(0.55));
  const damaged = colors.map((cl) => new THREE.Color(cl.light).multiplyScalar(1.6));
  let last = '';
  const update = (states, t = 0) => {
    const key = states ? states.join('') : '';
    if (key === last && !(states && states.includes(1))) return;
    last = key;
    for (let i = 0; i < n; i++) {
      const tl = tiles[i], st = states ? states[i] : 0;
      m.compose(v.set(tl.x, 0, tl.z), q, s.setScalar(st >= 2 ? 0 : 1)); mesh.setMatrixAt(i, m);
      if (st === 1) c.copy(damaged[tl.team]).multiplyScalar(0.8 + 0.2 * Math.sin(t * 8 + i)); else c.copy(intact[tl.team]);
      mesh.setColorAt(i, c);
      m.compose(v.set(tl.x, 0.014, tl.z), q, s.setScalar(st >= 2 ? 1 : 0)); holes.setMatrixAt(i, m);
      holes.setColorAt(i, c.set(colors[tl.team].light));
    }
    mesh.instanceMatrix.needsUpdate = true; holes.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true; holes.instanceColor.needsUpdate = true;
  };
  update(null);
  group.add(mesh, holes);
  return update;
}

// ------------------------------------------------------------------ surroundings
function skyDome(theme) {
  const s = theme.sky;
  const sunDir = new THREE.Vector3(...(s.sun || [0, -1, 0])).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(s.top) }, horizon: { value: new THREE.Color(s.horizon) }, bottom: { value: new THREE.Color(s.bottom) },
      sunDir: { value: sunDir }, sunColor: { value: new THREE.Color(s.sunColor || 0) }, sunSize: { value: s.sun ? s.sunSize || 1 : 0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunSize; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = d.y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 1.0, h), 0.55)) : mix(horizon, bottom, smoothstep(0.0, 0.2, -h));
        float s = max(dot(d, sunDir), 0.0);
        c += sunColor * (step(0.9993, s) * 3.0 * sign(sunSize) + pow(s, 14.0) * 0.4 * sunSize + pow(s, 3.0) * 0.12 * sunSize);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(800, 48, 24), mat);
  m.renderOrder = -10; m.frustumCulled = false; m.userData.dynamic = true;
  return m;
}

// outer plan edges with outward normals (for stands, boards, screens)
function planEdges(arena) {
  const o = arena.outer, out = [];
  for (let i = 0; i < o.length; i++) {
    const [ax, az] = o[i], [bx, bz] = o[(i + 1) % o.length];
    const ex = bx - ax, ez = bz - az, len = Math.hypot(ex, ez);
    out.push({ mx: (ax + bx) / 2, mz: (az + bz) / 2, len, nx: ez / len, nz: -ex / len, end: Math.abs(-ex / len) > 0.99 });
  }
  return out;
}

function ledTexture(colors, text) {
  const [c, g] = canvas(512, 64);
  const grd = g.createLinearGradient(0, 0, 512, 0);
  grd.addColorStop(0, colors[0].css); grd.addColorStop(0.5, '#0b1020'); grd.addColorStop(1, colors[1].css);
  g.fillStyle = grd; g.fillRect(0, 0, 512, 64);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.font = 'italic 700 34px "Chakra Petch", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 34);
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 64; y += 3) g.fillRect(0, y, 512, 1);
  return tex(c, { repeat: true });
}

function screenTexture(name, colors) {
  const [c, g] = canvas(512, 192);
  const grd = g.createLinearGradient(0, 0, 512, 192);
  grd.addColorStop(0, '#050816'); grd.addColorStop(1, '#141c36');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 192);
  g.fillStyle = colors[0].css; g.fillRect(0, 0, 256, 10); g.fillStyle = colors[1].css; g.fillRect(256, 0, 256, 10);
  g.fillStyle = '#f8fafc'; g.font = 'italic 800 56px "Chakra Petch", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('OVERDRIVE', 256, 88);
  g.fillStyle = 'rgba(203,213,225,0.85)'; g.font = '600 24px "Chakra Petch", system-ui, sans-serif'; g.fillText(name.toUpperCase(), 256, 146);
  return tex(c);
}

function buildStands(arena, theme, colors, quality, group) {
  const g = new THREE.Group();
  const H = arena.p.height, tiers = theme.tiers || 7;
  const standMat = new THREE.MeshStandardMaterial({ color: theme.standColor, roughness: 0.85 });
  const edgeMat = new THREE.MeshStandardMaterial({ color: theme.standColor, emissive: new THREE.Color(theme.accent), emissiveIntensity: 0.35, roughness: 0.6 });
  const led = new THREE.MeshBasicMaterial({ map: ledTexture(colors, 'OVERDRIVE  ·  OVERDRIVE') });
  const crowd = [];
  for (const e of planEdges(arena)) {
    const d0 = 3.5 + (arena.mode === 'soccar' && e.end ? arena.p.goalDepth : 0);
    const len = e.len + 14;
    const grp = new THREE.Group();
    for (let t = 0; t < tiers; t++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, len + t * 3), standMat);
      step.position.set(d0 + 1.5 + t * 3, 0.8 + t * 2.4, 0); grp.add(step);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, len + t * 3), edgeMat);
      lip.position.set(d0 + t * 3 + 0.05, 1.62 + t * 2.4, 0); grp.add(lip);
      for (let k = -len / 2 + 1; k < len / 2 - 1; k += 1.4) crowd.push({ grp, x: d0 + 1.2 + t * 3, y: 2.2 + t * 2.4, z: k + (Math.random() - 0.5) * 0.4 });
    }
    // LED advertising board in front of the first tier
    const board = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.1), led.clone());
    board.material.map = led.map.clone(); board.material.map.repeat.set(Math.max(1, Math.round(len / 18)), 1); board.material.map.needsUpdate = true;
    board.position.set(d0 - 0.05, 0.75, 0); board.rotation.y = -Math.PI / 2; board.userData.dynamic = true;
    grp.add(board);
    if (theme.surround.includes('roof')) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(tiers * 3 + 6, 0.5, len + tiers * 3), new THREE.MeshStandardMaterial({ color: theme.roofColor, roughness: 0.7 }));
      roof.position.set(d0 + tiers * 1.5 + 1, tiers * 2.4 + 7, 0); roof.rotation.z = 0.12; grp.add(roof);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, len + tiers * 3), new THREE.MeshBasicMaterial({ color: 0xf8fafc }));
      strip.position.set(d0 - 1.5, tiers * 2.4 + 6.3, 0); grp.add(strip);
    }
    grp.position.set(e.mx, 0, e.mz); grp.rotation.y = Math.atan2(-e.nz, e.nx);
    g.add(grp);
  }
  // crowd as one instanced mesh, fans lean towards the team at their end
  const n = quality === 'low' ? Math.floor(crowd.length / 3) : crowd.length;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.1, 0.6), new THREE.MeshStandardMaterial({ roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color();
  const palette = [0xe5e7eb, 0x9ca3af, 0x374151];
  g.updateMatrixWorld(true);
  for (let i = 0; i < n; i++) {
    const cp = crowd[Math.floor((i * crowd.length) / n)];
    v.set(cp.x, cp.y, cp.z).applyMatrix4(cp.grp.matrixWorld);
    sc.set(1, 0.8 + Math.random() * 0.4, 1);
    m.compose(v, q, sc); inst.setMatrixAt(i, m);
    const zside = v.z > 10 ? 1 : v.z < -10 ? 0 : -1;
    let col = palette[Math.floor(Math.random() * 3)];
    if (zside >= 0 && Math.random() < 0.6) col = Math.random() < 0.5 ? colors[zside].main : colors[zside].light;
    inst.setColorAt(i, c.set(col));
  }
  mergeByMaterial(g);
  g.add(inst);
  group.add(g);
  void H;
}

function buildTowers(arena, theme, group) {
  const g = new THREE.Group();
  const H = arena.p.height;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.6, roughness: 0.4 });
  const headMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4) });
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = sx * (arena.halfW + 24), z = sz * (arena.halfL * 0.8 + 20);
    const hgt = H + 34;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, hgt, 8), poleMat); pole.position.set(x, hgt / 2, z); g.add(pole);
    const head = new THREE.Group(); head.position.set(x, hgt, z); head.lookAt(0, 0, 0);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(7, 4, 0.5), headMat); head.add(panel);
    const back = new THREE.Mesh(new THREE.BoxGeometry(7.4, 4.4, 0.6), poleMat); back.position.z = -0.4; head.add(back);
    g.add(head);
  }
  mergeByMaterial(g);
  group.add(g);
}

function buildScreens(arena, theme, colors, group) {
  const H = arena.p.height;
  const mat = new THREE.MeshBasicMaterial({ map: screenTexture(theme.name, colors) });
  const frame = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.5, roughness: 0.4 });
  for (const s of [-1, 1]) {
    const z = s * (arena.halfL + (arena.mode === 'soccar' ? arena.p.goalDepth : 0) + 18);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(26, 9.75), mat); scr.position.set(0, H + 12, z); scr.lookAt(0, H + 4, 0);
    const fr = new THREE.Mesh(new THREE.BoxGeometry(27, 10.6, 0.6), frame); fr.position.copy(scr.position); fr.quaternion.copy(scr.quaternion); fr.translateZ(-0.35);
    group.add(scr, fr);
  }
}

function rand(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

function buildCity(arena, theme, quality, group) {
  const cfg = theme.city || { near: 100, far: 240, hMin: 25, hMax: 110, glow: 0xffd28a };
  const [c, g] = canvas(64, 128);
  g.fillStyle = '#05070d'; g.fillRect(0, 0, 64, 128);
  const r = rand(7);
  for (let y = 2; y < 128; y += 6) for (let x = 2; x < 64; x += 6) if (r() < 0.45) { g.fillStyle = r() < 0.75 ? '#ffd9a0' : '#9be7ff'; g.globalAlpha = 0.5 + r() * 0.5; g.fillRect(x, y, 3, 3); }
  g.globalAlpha = 1;
  const t = tex(c, { repeat: true }); t.repeat.set(2, 3);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1c2230, map: t, emissive: new THREE.Color(cfg.glow), emissiveMap: t, emissiveIntensity: 1.1, roughness: 0.6, metalness: 0.3 });
  const n = quality === 'low' ? 70 : 190;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), mat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2 + r() * 0.05, d = cfg.near + r() * (cfg.far - cfg.near);
    const h = cfg.hMin + Math.pow(r(), 1.6) * (cfg.hMax - cfg.hMin);
    q.setFromAxisAngle(v.set(0, 1, 0), ang);
    m.compose(v.set(Math.sin(ang) * d, -6, Math.cos(ang) * d), q, s.set(8 + r() * 16, h, 8 + r() * 16));
    inst.setMatrixAt(i, m);
  }
  group.add(inst);
  // rooftop beacons
  const bp = [];
  for (let i = 0; i < 40; i++) { const ang = r() * Math.PI * 2, d = cfg.near + r() * (cfg.far - cfg.near); bp.push(Math.sin(ang) * d, cfg.hMin + r() * (cfg.hMax - cfg.hMin), Math.cos(ang) * d); }
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  group.add(new THREE.Points(bg, new THREE.PointsMaterial({ color: 0xff4d6d, size: 3, sizeAttenuation: false })));
}

function buildGround(theme, group, y = -0.06) {
  const g = new THREE.Mesh(new THREE.CircleGeometry(900, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: theme.ground, roughness: 0.95 }));
  g.position.y = y; g.receiveShadow = true;
  group.add(g);
}

function buildWater(group) {
  const w = new THREE.Mesh(new THREE.CircleGeometry(900, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x070a1c, roughness: 0.06, metalness: 0.95 }));
  w.position.y = -3;
  group.add(w);
  // deck around the arena
  const deck = new THREE.Mesh(new THREE.CircleGeometry(95, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x141827, roughness: 0.8 }));
  deck.position.y = -0.08; group.add(deck);
  const edge = new THREE.Mesh(new THREE.TorusGeometry(95, 0.25, 6, 96).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
  edge.position.y = -0.05; group.add(edge);
}

function buildMountains(quality, group) {
  const r = rand(11);
  const rock = new THREE.MeshStandardMaterial({ color: 0x6b7a8c, roughness: 1, flatShading: true });
  const snow = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9, flatShading: true });
  const g = new THREE.Group();
  for (let i = 0; i < 26; i++) {
    const ang = (i / 26) * Math.PI * 2 + r() * 0.2, d = 300 + r() * 120, h = 90 + r() * 140, rad = 60 + r() * 60;
    const seg = 5 + Math.floor(r() * 3);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, seg), rock); m.position.set(Math.sin(ang) * d, h / 2 - 4, Math.cos(ang) * d); m.rotation.y = r() * 3;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.36, h * 0.36, seg), snow); cap.position.copy(m.position); cap.position.y = h - 4 - h * 0.18; cap.rotation.y = m.rotation.y;
    g.add(m, cap);
  }
  mergeByMaterial(g);
  group.add(g);
  void quality;
}

function buildPines(quality, group, near = 70, far = 170, color = 0x284238) {
  const r = rand(5);
  const n = quality === 'low' ? 90 : 260;
  const inst = new THREE.InstancedMesh(new THREE.ConeGeometry(3, 12, 7).translate(0, 6, 0), new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, d = near + r() * (far - near), k = 0.7 + r() * 0.9;
    m.compose(v.set(Math.sin(ang) * d, -0.1, Math.cos(ang) * d), q, s.set(k, k * (0.9 + r() * 0.5), k)); inst.setMatrixAt(i, m);
  }
  group.add(inst);
}

function buildTrees(quality, group) {
  const r = rand(9);
  const n = quality === 'low' ? 70 : 200;
  const crowns = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(4, 0).translate(0, 8, 0), new THREE.MeshStandardMaterial({ color: 0x3b7a35, roughness: 1, flatShading: true }), n);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.4, 0.6, 6, 6).translate(0, 3, 0), new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const ang = r() * Math.PI * 2, d = 85 + r() * 110, k = 0.8 + r() * 0.8;
    m.compose(v.set(Math.sin(ang) * d, -0.1, Math.cos(ang) * d), q, s.setScalar(k));
    crowns.setMatrixAt(i, m); trunks.setMatrixAt(i, m);
    crowns.setColorAt(i, c.setHSL(0.27 + r() * 0.06, 0.45, 0.28 + r() * 0.1));
  }
  group.add(crowns, trunks);
}

function buildDunes(group) {
  const geo = new THREE.PlaneGeometry(1600, 1600, 160, 160).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z);
    const k = Math.min(1, Math.max(0, (d - 90) / 80));
    const h = (Math.sin(x * 0.021 + Math.cos(z * 0.013) * 2) * 9 + Math.sin(z * 0.033 + x * 0.008) * 5 + Math.sin((x + z) * 0.06) * 1.5 + 8) * k;
    p.setY(i, h - 0.1);
  }
  geo.computeVertexNormals();
  group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd59a5c, roughness: 1 })));
}

function buildMesas(group) {
  const r = rand(3);
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xa4552f, roughness: 1, flatShading: true });
  const top = new THREE.MeshStandardMaterial({ color: 0xc77a45, roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i++) {
    const ang = r() * Math.PI * 2, d = 330 + r() * 160, h = 40 + r() * 60, rad = 25 + r() * 40;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.8, rad, h, 7), mat); m.position.set(Math.sin(ang) * d, h / 2, Math.cos(ang) * d);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * 0.82, rad * 0.8, 3, 7), top); cap.position.copy(m.position); cap.position.y = h + 1.5;
    g.add(m, cap);
  }
  mergeByMaterial(g);
  group.add(g);
}

function buildSkyRing(arena, theme, group) {
  const R = Math.max(arena.halfW, arena.halfL) + 30;
  const mat = new THREE.MeshBasicMaterial({ color: theme.accent });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.6, 8, 160), mat);
  ring.rotation.x = Math.PI / 2; ring.position.y = arena.p.height + 6;
  const ring2 = ring.clone(); ring2.scale.setScalar(1.15); ring2.position.y = -2;
  // underside platform so the arena reads as floating
  const plat = new THREE.Mesh(new THREE.CylinderGeometry(R - 8, R * 0.4, 18, 48, 1), new THREE.MeshStandardMaterial({ color: 0x1b1530, roughness: 0.7, metalness: 0.4 }));
  plat.position.y = -9.2;
  group.add(ring, ring2, plat);
}

function buildStars(group) {
  const sp = [];
  const r = rand(17);
  for (let i = 0; i < 2200; i++) { const th = r() * Math.PI * 2, ph = r() * Math.PI * 0.62; const R = 700; sp.push(R * Math.cos(th) * Math.sin(ph), R * Math.cos(ph) - 60, R * Math.sin(th) * Math.sin(ph)); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false }));
  group.add(pts);
}

function buildPlanet(group) {
  const pl = new THREE.Mesh(new THREE.SphereGeometry(140, 48, 24), new THREE.MeshStandardMaterial({ color: 0x2b6cb0, emissive: 0x0b2a55, emissiveIntensity: 0.6, roughness: 0.8, fog: false }));
  pl.position.set(-380, 160, -520);
  const ring = new THREE.Mesh(new THREE.RingGeometry(180, 260, 96), new THREE.MeshBasicMaterial({ color: 0x93c5fd, transparent: true, opacity: 0.35, side: THREE.DoubleSide, fog: false }));
  ring.position.copy(pl.position); ring.rotation.x = 1.2; ring.rotation.y = 0.3;
  group.add(pl, ring);
}

function buildClouds(group) {
  const r = rand(21);
  const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(10, 1), new THREE.MeshStandardMaterial({ color: 0xc4b5fd, roughness: 1, transparent: true, opacity: 0.55, flatShading: true }), 90);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < 90; i++) {
    const ang = r() * Math.PI * 2, d = 120 + r() * 380;
    m.compose(v.set(Math.sin(ang) * d, -40 - r() * 30, Math.cos(ang) * d), q, s.set(2 + r() * 3, 0.6 + r() * 0.5, 2 + r() * 3)); inst.setMatrixAt(i, m);
  }
  group.add(inst);
}

function buildSnow(quality) {
  const n = quality === 'low' ? 600 : 1800;
  const pos = new Float32Array(n * 3);
  const r = rand(31);
  for (let i = 0; i < n; i++) { pos[i * 3] = (r() - 0.5) * 220; pos[i * 3 + 1] = r() * 70; pos[i * 3 + 2] = (r() - 0.5) * 220; }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85, depthWrite: false }));
  pts.frustumCulled = false;
  const update = (dt, t) => {
    for (let i = 0; i < n; i++) {
      let y = pos[i * 3 + 1] - dt * (2.2 + (i % 7) * 0.25);
      if (y < 0) y += 70;
      pos[i * 3 + 1] = y;
      pos[i * 3] += Math.sin(t * 0.7 + i) * dt * 0.6;
    }
    geo.attributes.position.needsUpdate = true;
  };
  return { pts, update };
}

// ------------------------------------------------------------------ assembly
export function buildArena(arena, themeId = 'stadium', colors = TEAM_COLORS, quality = 'high') {
  const theme = ARENA_THEMES[themeId] || ARENA_THEMES.stadium;
  const group = new THREE.Group();
  const H = arena.p.height, a = arena.halfW, b = arena.halfL;
  const updaters = [];

  const bowl = buildBowl(arena, theme, colors);
  group.add(bowl.shell, bowl.floor, bowl.ceil, ...bowl.trims);

  if (arena.mode === 'soccar') buildGoals(arena, theme, colors, group);
  else if (arena.mode === 'hoops') buildHoops(arena, theme, colors, group);
  let setTiles = null;
  if (arena.mode === 'dropshot') setTiles = buildTiles(arena, colors, group);

  // team-coloured light strip along each end wall
  for (const team of [0, 1]) {
    const s = team ? 1 : -1;
    const xs = bowl.cols.filter((c) => c.endWall && c.z * s > 0).map((c) => Math.abs(c.x));
    const half = xs.length ? Math.max(...xs) : a - arena.Rc;
    const y = arena.mode === 'soccar' ? arena.p.goalHeight + 1.6 : arena.mode === 'hoops' ? arena.rimY + 4.6 : H * 0.45;
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2 * half, 0.35), new THREE.MeshBasicMaterial({ color: colors[team].main, transparent: true, opacity: 0.9 }));
    strip.position.set(0, y, s * (b - 0.03)); strip.rotation.y = s > 0 ? Math.PI : 0;
    group.add(strip);
  }

  // world around the bowl
  const world = new THREE.Group();
  world.add(skyDome(theme));
  const sur = theme.surround;
  if (sur.includes('stands')) buildStands(arena, theme, colors, quality, world);
  if (sur.includes('towers')) buildTowers(arena, theme, world);
  if (sur.includes('screens')) buildScreens(arena, theme, colors, world);
  if (sur.includes('water')) buildWater(world);
  else if (sur.includes('dunes')) buildDunes(world);
  else if (theme.ground !== undefined) buildGround(theme, world);
  if (sur.includes('city')) buildCity(arena, theme, quality, world);
  if (sur.includes('mountains')) buildMountains(quality, world);
  if (sur.includes('pines')) buildPines(quality, world);
  if (sur.includes('trees')) buildTrees(quality, world);
  if (sur.includes('mesas')) buildMesas(world);
  if (sur.includes('skyring')) buildSkyRing(arena, theme, world);
  if (sur.includes('stars')) buildStars(world);
  if (sur.includes('planet')) buildPlanet(world);
  if (sur.includes('clouds')) buildClouds(world);
  if (sur.includes('snow')) { const sn = buildSnow(quality); world.add(sn.pts); updaters.push(sn.update); }
  group.add(world);

  // lights
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1]);
  sun.position.set(...(theme.sunPos || [30, 80, 20]));
  if (quality !== 'low') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera; const ext = Math.max(a, b) + 14;
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 260;
    sun.shadow.bias = -0.0008;
  }
  // keep the shadow frustum centred on the pitch even for low sun angles
  const sp = new THREE.Vector3(...(theme.sunPos || [30, 80, 20])).normalize().multiplyScalar(120);
  sun.position.copy(sp);
  group.add(sun, sun.target);

  return {
    group, theme, floorMat: bowl.floorMat, shellMat: bowl.shellMat,
    setTiles,
    update(dt, t) { for (const f of updaters) f(dt, t); },
  };
}
