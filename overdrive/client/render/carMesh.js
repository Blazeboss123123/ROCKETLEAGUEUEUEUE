// Procedural, original car models (visual only — every body shares one gameplay hitbox).
// Bodies are lofted from cross-sections (rounded superellipses) so they read as smooth, sculpted
// shells: tapered noses, fender arches over the wheels, tumblehome cabins, real tyres with tread,
// rims with brake discs, lights, twin boost nozzles and per-body aero parts.
// Local frame matches the simulation: forward +Z, up +Y, left +X. Origin is 0.36 m above the ground.
import * as THREE from 'three';
import { DEFAULT_LOADOUT } from '../cosmetics.js';
import { mergeByMaterial } from './merge.js';

const GROUND = -0.36;

// Body definitions. Stations: [z, bottom, top, halfWidth]. Cabin stations: [z, base, roof, baseHalfW, roofHalfW].
const BODIES = {
  comet: {
    stations: [[0.74, -0.16, -0.08, 0.30], [0.66, -0.2, -0.02, 0.38], [0.5, -0.07, 0.03, 0.43], [0.3, -0.07, 0.07, 0.44], [0.12, -0.23, 0.1, 0.44],
      [-0.12, -0.23, 0.12, 0.44], [-0.3, -0.07, 0.12, 0.45], [-0.5, -0.07, 0.11, 0.44], [-0.64, -0.18, 0.1, 0.4], [-0.72, -0.15, 0.06, 0.32]],
    cabin: [[0.22, 0.07, 0.08, 0.33, 0.26], [0.06, 0.09, 0.24, 0.34, 0.24], [-0.22, 0.11, 0.25, 0.34, 0.24], [-0.44, 0.11, 0.13, 0.35, 0.28]],
    round: 4.2, wheelR: 0.19, wheelZ: [0.41, -0.41], wheelX: 0.43, fenders: true, wing: 'high',
  },
  strider: {
    stations: [[0.74, -0.17, -0.06, 0.32], [0.64, -0.21, 0.0, 0.4], [0.5, -0.06, 0.05, 0.43], [0.3, -0.06, 0.08, 0.43], [0.12, -0.23, 0.1, 0.43],
      [-0.12, -0.23, 0.11, 0.43], [-0.3, -0.06, 0.11, 0.44], [-0.5, -0.06, 0.1, 0.43], [-0.64, -0.2, 0.09, 0.4], [-0.72, -0.16, 0.05, 0.33]],
    cabin: [[0.2, 0.08, 0.09, 0.34, 0.27], [0.04, 0.1, 0.27, 0.34, 0.25], [-0.28, 0.11, 0.28, 0.34, 0.25], [-0.52, 0.1, 0.12, 0.35, 0.29]],
    round: 4.5, wheelR: 0.19, wheelZ: [0.41, -0.41], wheelX: 0.43, fenders: true, wing: 'lip',
  },
  rampart: {
    stations: [[0.72, -0.15, 0.0, 0.38], [0.64, -0.2, 0.06, 0.43], [0.5, -0.04, 0.09, 0.45], [0.3, -0.04, 0.1, 0.45], [0.12, -0.22, 0.11, 0.45],
      [-0.12, -0.22, 0.12, 0.45], [-0.3, -0.04, 0.12, 0.46], [-0.5, -0.04, 0.12, 0.45], [-0.64, -0.2, 0.12, 0.43], [-0.7, -0.17, 0.1, 0.39]],
    cabin: [[0.2, 0.09, 0.1, 0.38, 0.32], [0.08, 0.1, 0.32, 0.38, 0.31], [-0.42, 0.12, 0.33, 0.39, 0.32], [-0.6, 0.12, 0.29, 0.39, 0.32]],
    round: 5.5, wheelR: 0.205, wheelZ: [0.4, -0.4], wheelX: 0.45, fenders: true, wing: 'roof', lightBar: true, flaps: true,
  },
  vanta: {
    stations: [[0.8, -0.15, -0.1, 0.24], [0.7, -0.19, -0.05, 0.36], [0.5, -0.08, 0.01, 0.42], [0.3, -0.08, 0.05, 0.43], [0.12, -0.22, 0.07, 0.42],
      [-0.12, -0.22, 0.1, 0.42], [-0.3, -0.08, 0.13, 0.43], [-0.52, -0.08, 0.15, 0.42], [-0.66, -0.17, 0.15, 0.38], [-0.74, -0.14, 0.12, 0.3]],
    cabin: [[0.24, 0.05, 0.06, 0.3, 0.24], [0.1, 0.07, 0.22, 0.29, 0.18], [-0.18, 0.1, 0.22, 0.29, 0.18], [-0.4, 0.13, 0.15, 0.3, 0.24]],
    round: 3.6, wheelR: 0.185, wheelZ: [0.44, -0.44], wheelX: 0.43, fenders: true, wing: 'fin', glowLine: true,
  },
  wisp: {
    stations: [[0.82, -0.12, -0.07, 0.07], [0.7, -0.14, -0.03, 0.11], [0.45, -0.15, 0.02, 0.15], [0.2, -0.16, 0.07, 0.19], [0.0, -0.17, 0.1, 0.22],
      [-0.2, -0.17, 0.12, 0.26], [-0.4, -0.16, 0.11, 0.26], [-0.56, -0.14, 0.09, 0.22], [-0.66, -0.12, 0.06, 0.17]],
    cabin: [[0.1, 0.07, 0.08, 0.13, 0.1], [-0.02, 0.09, 0.2, 0.13, 0.08], [-0.2, 0.11, 0.21, 0.14, 0.08], [-0.34, 0.11, 0.14, 0.15, 0.1]],
    round: 2.4, wheelR: 0.2, wheelZ: [0.47, -0.42], wheelX: 0.47, fenders: false, wing: 'formula', openWheel: true,
  },
};

const WHEEL_COLORS = { chrome: 0xd4d4d8, black: 0x24262b, gold: 0xd4a017, white: 0xf2f2ee };
const GLOW_COLORS = { cyan: 0x22d3ee, magenta: 0xe879f9, lime: 0xa3e635 };

// ---------------------------------------------------------------- geometry helpers
function catmull(pts, t) {
  // pts: array of numbers sampled at uniform parameter; Catmull-Rom interpolation at t in [0, n-1]
  const n = pts.length, i = Math.min(n - 2, Math.max(0, Math.floor(t))), f = t - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
  return 0.5 * ((2 * p1) + (-p0 + p2) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (-p0 + 3 * p1 - 3 * p2 + p3) * f * f * f);
}

// Loft a closed shell through cross-sections. section(i) -> {z, ring: [[x,y],...]} (same count each).
function loft(sections, capEnds = true) {
  const S = sections.length, M = sections[0].ring.length;
  const pos = [];
  for (const s of sections) for (const [x, y] of s.ring) pos.push(x, y, s.z);
  const idx = [];
  for (let i = 0; i < S - 1; i++) for (let j = 0; j < M; j++) {
    const a = i * M + j, b = i * M + ((j + 1) % M), c = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M);
    idx.push(a, c, b, b, c, d);
  }
  if (capEnds) {
    for (const [si, flip] of [[0, false], [S - 1, true]]) {
      const s = sections[si];
      let cx = 0, cy = 0; for (const [x, y] of s.ring) { cx += x; cy += y; }
      const ci = pos.length / 3; pos.push(cx / M, cy / M, s.z);
      for (let j = 0; j < M; j++) { const a = si * M + j, b = si * M + ((j + 1) % M); if (flip) idx.push(ci, b, a); else idx.push(ci, a, b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// rounded-rectangle (superellipse) ring; widthAt(y01) lets the cabin lean inwards (tumblehome)
function ring(cy, hh, hw, n, M, widthAt) {
  const out = [];
  for (let j = 0; j < M; j++) {
    const a = (j / M) * Math.PI * 2;
    const c = Math.cos(a), s = Math.sin(a);
    const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / n), y = Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    const w = widthAt ? widthAt((y + 1) / 2) : hw;
    out.push([x * w, cy + y * hh]);
  }
  return out;
}

function bodyShell(def, sectionsN = 30, M = 28) {
  const st = def.stations;
  const zs = st.map((s) => s[0]), bot = st.map((s) => s[1]), top = st.map((s) => s[2]), hw = st.map((s) => s[3]);
  const secs = [];
  for (let k = 0; k < sectionsN; k++) {
    const t = (k / (sectionsN - 1)) * (st.length - 1);
    const z = catmull(zs, t), b = catmull(bot, t), tp = catmull(top, t), w = Math.max(0.02, catmull(hw, t));
    secs.push({ z, ring: ring((b + tp) / 2, Math.max(0.01, (tp - b) / 2), w, def.round, M) });
  }
  return loft(secs);
}

function cabinShell(def, sectionsN = 14, M = 24) {
  const st = def.cabin;
  const secs = [];
  for (let k = 0; k < sectionsN; k++) {
    const t = (k / (sectionsN - 1)) * (st.length - 1);
    const z = catmull(st.map((s) => s[0]), t), b = catmull(st.map((s) => s[1]), t), r = catmull(st.map((s) => s[2]), t);
    const bw = catmull(st.map((s) => s[3]), t), tw = catmull(st.map((s) => s[4]), t);
    secs.push({ z, ring: ring((b + r) / 2, Math.max(0.005, (r - b) / 2), bw, 3, M, (y01) => bw + (tw - bw) * y01) });
  }
  return loft(secs);
}

export function paintMaterial(color, finish) {
  if (finish === 'pearl') return new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 900] });
  if (finish === 'metal') return new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, metalness: 0.85, clearcoat: 0.6, clearcoatRoughness: 0.2 });
  if (finish === 'matte') return new THREE.MeshStandardMaterial({ color, roughness: 0.78, metalness: 0.05 });
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.18, metalness: 0.08, clearcoat: 1, clearcoatRoughness: 0.08 });
}

let _shared = null;
function shared() {
  if (_shared) return _shared;
  const tread = (() => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#17181c'; g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#0b0c0f';
    for (let y = 0; y < 256; y += 16) { g.fillRect(6, y, 22, 7); g.fillRect(36, y + 8, 22, 7); }
    g.fillRect(30, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  _shared = {
    rubber: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tread, roughness: 0.92, metalness: 0 }),
    sidewall: new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.85 }),
    trim: new THREE.MeshPhysicalMaterial({ color: 0x0d0f14, roughness: 0.35, metalness: 0.3, clearcoat: 0.5 }),
    carbon: new THREE.MeshStandardMaterial({ color: 0x17191f, roughness: 0.55, metalness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x070b14, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x55585f, roughness: 0.45, metalness: 0.85 }),
    nozzle: new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.3, metalness: 0.9 }),
    head: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe8f1ff, emissiveIntensity: 2.2, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1f2e, emissiveIntensity: 2.0, roughness: 0.3 }),
  };
  return _shared;
}

// Tyre with rounded shoulders (lathe) + tread texture, rim with depth, brake disc, caliper.
function buildWheel(style, r, rimColor, teamCol, width = 0.17) {
  const S = shared();
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const hw = width / 2, sh = 0.035;
  const prof = [];
  const inner = r * 0.66;
  prof.push(new THREE.Vector2(inner, -hw));
  for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, -hw + sh + Math.sin(a) * sh)); }
  for (let i = 0; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); prof.push(new THREE.Vector2(r - sh + Math.cos(a) * sh, hw - sh + Math.sin(a) * sh)); }
  prof.push(new THREE.Vector2(inner, hw));
  const tyreGeo = new THREE.LatheGeometry(prof, 32);
  tyreGeo.rotateZ(Math.PI / 2); // lathe axis Y -> X (axle)
  const tyre = new THREE.Mesh(tyreGeo, S.rubber);
  S.rubber.map.repeat.set(1, 3);
  spin.add(tyre);
  const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.22, metalness: 0.92 });
  // rim barrel (open cylinder) and face
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(inner, inner, width * 0.9, 28, 1, true), rimMat);
  barrel.rotation.z = Math.PI / 2; spin.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(inner, 0.012, 6, 28), rimMat);
  for (const s of [-1, 1]) { const l = lip.clone(); l.rotation.y = Math.PI / 2; l.position.x = s * width * 0.45; spin.add(l); }
  const face = new THREE.Group(); face.position.x = width * 0.36;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.18, 0.03, 16), rimMat); hub.rotation.z = Math.PI / 2; face.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.08, r * 0.08, 0.035, 12), new THREE.MeshStandardMaterial({ color: teamCol, metalness: 0.5, roughness: 0.3 }));
  cap.rotation.z = Math.PI / 2; cap.position.x = 0.005; face.add(cap);
  if (style === 'disc') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.97, inner * 0.97, 0.012, 32), rimMat); d.rotation.z = Math.PI / 2; face.add(d);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.016, 8), S.trim); h.rotation.z = Math.PI / 2; h.position.set(0.002, Math.cos(a) * inner * 0.6, Math.sin(a) * inner * 0.6); face.add(h); }
  } else if (style === 'halo') {
    const ringG = new THREE.Mesh(new THREE.TorusGeometry(inner * 0.75, 0.012, 6, 28), new THREE.MeshBasicMaterial({ color: teamCol }));
    ringG.rotation.y = Math.PI / 2; face.add(ringG);
    for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.014, inner * 0.95, 0.03), rimMat); sp.rotation.x = (i / 4) * Math.PI; face.add(sp); }
  } else {
    const n = style === 'tri' ? 3 : style === 'turbine' ? 10 : style === 'mesh' ? 14 : 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const len = inner * 0.85;
      const sp = new THREE.Mesh(new THREE.BoxGeometry(style === 'turbine' ? 0.01 : 0.02, len, style === 'tri' ? 0.07 : style === 'mesh' ? 0.012 : 0.032), rimMat);
      sp.position.set(-0.004, Math.cos(a) * len / 2, Math.sin(a) * len / 2);
      sp.rotation.x = -a;
      if (style === 'turbine') sp.rotation.y = 0.5;
      face.add(sp);
      if (style === 'mesh' && i % 2 === 0) { const cr = sp.clone(); cr.rotation.x = -a + 0.5; face.add(cr); }
    }
  }
  spin.add(face);
  g.add(spin);
  // brake disc and caliper do not spin
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(inner * 0.78, inner * 0.78, 0.014, 24), S.disc);
  disc.rotation.z = Math.PI / 2; disc.position.x = width * 0.12; g.add(disc);
  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.03, inner * 0.42, inner * 0.3), new THREE.MeshStandardMaterial({ color: teamCol, roughness: 0.35, metalness: 0.4 }));
  caliper.position.set(width * 0.2, inner * 0.5, -inner * 0.2); g.add(caliper);
  g.userData.spin = spin;
  return g;
}

function fender(r, width, paint) {
  // half-torus arch over a wheel, slightly wider than the tyre
  const geo = new THREE.TorusGeometry(r + 0.03, 0.03, 8, 22, Math.PI);
  geo.scale(1, 1, (width + 0.05) / 0.06);
  geo.rotateY(Math.PI / 2);
  return new THREE.Mesh(geo, paint);
}

function glowTexture() {
  if (glowTexture.t) return glowTexture.t;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  glowTexture.t = new THREE.CanvasTexture(c);
  return glowTexture.t;
}
export { glowTexture };

export function buildCar(cosIn, teamColor, opts = {}) {
  const cos = { ...DEFAULT_LOADOUT, ...(cosIn || {}) };
  const def = BODIES[cos.body] || BODIES.strider;
  const S = shared();
  const team = new THREE.Color(teamColor.main);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = paintMaterial(new THREE.Color(cos.paint), cos.finish);
  const accent = paintMaterial(new THREE.Color(cos.accent), cos.finish === 'pearl' ? 'gloss' : cos.finish);
  const teamMat = new THREE.MeshStandardMaterial({ color: team, emissive: team, emissiveIntensity: 1.1, roughness: 0.4 });

  // ---- shell + glasshouse
  const shellGeo = bodyShell(def);
  const shell = new THREE.Mesh(shellGeo, paint);
  shell.castShadow = true;
  body.add(shell);
  if (def.openWheel) {
    const cabin = new THREE.Mesh(cabinShell(def), S.glass); cabin.castShadow = true; body.add(cabin);
  } else {
    // painted roof and pillars, with a tinted glass band wrapped around below the roof line
    const roofShell = new THREE.Mesh(cabinShell(def), cos.decal === 'split' ? accent : paint);
    roofShell.castShadow = true; body.add(roofShell);
    const band = { ...def, cabin: def.cabin.map(([z, b, r, bw, tw]) => [z + (z > 0 ? 0.012 : -0.012), b + 0.01, b + (r - b) * 0.84, bw + 0.012, bw + (tw - bw) * 0.84 + 0.012]) };
    body.add(new THREE.Mesh(cabinShell(band), S.glass));
  }
  const frontZ = def.stations[0][0], rearZ = def.stations[def.stations.length - 1][0];
  const halfW = Math.max(...def.stations.map((s) => s[3]));

  // ---- under-tray, splitter, diffuser
  const tray = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.3, 0.03, (frontZ - rearZ) * 0.7), S.carbon);
  tray.position.set(0, -0.2, (frontZ + rearZ) / 2); body.add(tray);
  if (!def.openWheel) {
    const split = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.35, 0.018, 0.07), S.carbon); split.position.set(0, -0.2, frontZ - 0.09); body.add(split);
    const diff = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.5, 0.05, 0.08), S.carbon); diff.position.set(0, -0.19, rearZ + 0.07); diff.rotation.x = -0.35; body.add(diff);
    for (let i = -2; i <= 2; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.06, 0.09), S.carbon); fin.position.set(i * 0.1, -0.18, rearZ + 0.06); body.add(fin); }
    // grille
    const grille = new THREE.Mesh(new THREE.BoxGeometry(halfW * 0.9, 0.05, 0.02), S.trim); grille.position.set(0, -0.12, frontZ - 0.035); body.add(grille);
  }

  // ---- lights
  const noseY = def.stations[1][2] - 0.02;
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 8), S.head);
    hl.scale.set(1.3, 0.38, 0.5); hl.position.set(s * (def.openWheel ? 0.08 : halfW * 0.62), noseY - 0.02, frontZ - 0.07); body.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(def.openWheel ? 0.05 : 0.14, 0.028, 0.02), S.tail);
    tl.position.set(s * (def.openWheel ? 0.07 : halfW * 0.6), def.stations[def.stations.length - 2][2] - 0.035, rearZ + 0.035); body.add(tl);
  }
  const tbar = new THREE.Mesh(new THREE.BoxGeometry(def.openWheel ? 0.12 : halfW * 0.7, 0.014, 0.02), teamMat);
  tbar.position.set(0, def.stations[def.stations.length - 2][2] - 0.065, rearZ + 0.03); body.add(tbar);

  // ---- team side stripes (lower body)
  if (!def.openWheel) for (const s of [-1, 1]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.36), teamMat);
    st.position.set(s * (halfW + 0.003), -0.12, 0); body.add(st);
  } else for (const s of [-1, 1]) {
    const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.36, 4, 10), accent); pod.rotation.x = Math.PI / 2; pod.position.set(s * 0.25, -0.1, -0.12); pod.castShadow = true; body.add(pod);
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.02, 0.3), teamMat); st.position.set(s * 0.322, -0.1, -0.12); body.add(st);
  }


  // ---- aero per body
  const tailTop = def.stations[def.stations.length - 2][2];
  if (def.wing === 'high') {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.04, 0.02, 0.15), accent); wing.position.set(0, tailTop + 0.13, rearZ + 0.1); wing.rotation.x = 0.12; body.add(wing);
    for (const s of [-1, 1]) {
      const up = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.13, 0.06), S.carbon); up.position.set(s * halfW * 0.55, tailTop + 0.065, rearZ + 0.12); body.add(up);
      const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.17), accent); ep.position.set(s * (halfW + 0.03), tailTop + 0.14, rearZ + 0.1); body.add(ep);
    }
  } else if (def.wing === 'lip') {
    const lipW = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.8, 0.025, 0.07), accent); lipW.position.set(0, tailTop + 0.012, rearZ + 0.07); lipW.rotation.x = 0.35; body.add(lipW);
  } else if (def.wing === 'roof') {
    const rs = new THREE.Mesh(new THREE.BoxGeometry(halfW * 1.6, 0.02, 0.1), accent); rs.position.set(0, def.cabin[3][2] + 0.01, def.cabin[3][0] - 0.02); rs.rotation.x = 0.25; body.add(rs);
  } else if (def.wing === 'fin') {
    const sh = new THREE.Shape(); sh.moveTo(0.05, 0); sh.lineTo(-0.3, 0.17); sh.lineTo(-0.34, 0.17); sh.lineTo(-0.3, 0); sh.closePath();
    const fg = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: false }); fg.rotateY(-Math.PI / 2); fg.translate(0.0075, 0, 0);
    const fin = new THREE.Mesh(fg, accent); fin.position.set(0, tailTop - 0.01, rearZ + 0.38); body.add(fin);
  } else if (def.wing === 'formula') {
    const fw = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.02, 0.16), accent); fw.position.set(0, -0.2, frontZ - 0.03); body.add(fw);
    for (const s of [-1, 1]) { const ep = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.07, 0.18), accent); ep.position.set(s * 0.51, -0.17, frontZ - 0.03); body.add(ep); }
    const rw = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.17), accent); rw.position.set(0, 0.26, rearZ + 0.02); rw.rotation.x = 0.15; body.add(rw);
    for (const s of [-1, 1]) { const ep = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.18, 0.2), accent); ep.position.set(s * 0.4, 0.2, rearZ + 0.02); body.add(ep); }
    const pyl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.06), S.carbon); pyl.position.set(0, 0.16, rearZ + 0.04); body.add(pyl);
    const intake = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 10), paint); intake.position.set(0, 0.2, -0.32); intake.scale.set(1, 1, 0.9); body.add(intake);
  }
  if (def.lightBar) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.035, 0.04), S.trim); bar.position.set(0, def.cabin[1][2] + 0.035, def.cabin[1][0] - 0.03); body.add(bar);
    for (let i = -2; i <= 2; i++) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 10), S.head); l.rotation.x = Math.PI / 2; l.position.set(i * 0.085, def.cabin[1][2] + 0.035, def.cabin[1][0] - 0.005); body.add(l); }
  }
  if (def.flaps) for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.11, 0.008), S.carbon); f.position.set(s * def.wheelX, GROUND + 0.1, def.wheelZ[1] - def.wheelR - 0.05); body.add(f); }
  if (def.glowLine) for (const s of [-1, 1]) { const gl = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.95), teamMat); gl.position.set(s * (halfW + 0.002), -0.035, 0); body.add(gl); }

  // ---- decals
  if (cos.decal === 'stripe') {
    const sg = bodyShell({ ...def, stations: def.stations.map(([z, b, t, w]) => [z, b, t + 0.004, Math.min(w, def.openWheel ? 0.05 : 0.07)]) }, 30, 20);
    for (const s of [-1, 1]) { const m = new THREE.Mesh(sg, accent); m.position.x = s * (def.openWheel ? 0.0 : 0.11); m.scale.set(1, 1.015, 1.004); body.add(m); if (def.openWheel) break; }
  } else if (cos.decal === 'split') {
    const sg = bodyShell({ ...def, stations: def.stations.map(([z, b, t, w]) => [z, b - 0.003, Math.min(t, b + 0.07), w + 0.004]) });
    body.add(new THREE.Mesh(sg, accent));
  } else if (cos.decal === 'hex') {
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) {
      const hx = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 6), accent);
      hx.rotation.z = Math.PI / 2; hx.position.set(s * (halfW + 0.004), -0.06 - (i % 2) * 0.045, -0.3 + i * 0.13); body.add(hx);
    }
  } else if (cos.decal === 'bolt') {
    for (const s of [-1, 1]) {
      const pts = [[0.36, -0.02], [0.08, -0.02], [0.14, -0.09], [-0.3, -0.09], [-0.06, -0.15], [-0.1, -0.06], [0.28, -0.06]];
      const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
      const geo = new THREE.ShapeGeometry(sh); geo.rotateY(s * Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cos.accent, side: THREE.DoubleSide, emissive: new THREE.Color(cos.accent), emissiveIntensity: 0.25 }));
      m.position.x = s * (halfW + 0.006); body.add(m);
    }
  }

  // ---- wheels + fenders
  const wheels = [];
  const rimCol = cos.wheelColor === 'team' ? teamColor.main : WHEEL_COLORS[cos.wheelColor] ?? 0xd4d4d8;
  const tyreW = def.openWheel ? 0.2 : 0.17;
  for (const z of def.wheelZ) for (const s of [-1, 1]) {
    const w = buildWheel(cos.wheels, def.wheelR, rimCol, teamColor.main, tyreW);
    if (s < 0) w.scale.x = -1; // rim face outwards on both sides
    w.position.set(s * def.wheelX, GROUND + def.wheelR, z);
    w.userData.front = z > 0; w.userData.r = def.wheelR;
    root.add(w); wheels.push(w);
    if (def.fenders) { const f = fender(def.wheelR, tyreW, paint); f.position.set(s * (def.wheelX - 0.01), GROUND + def.wheelR, z); body.add(f); }
  }

  // ---- antenna & toppers
  const roofTop = Math.max(...def.cabin.map((c) => c[2]));
  const roofZ = (def.cabin[1][0] + def.cabin[2][0]) / 2;
  if (cos.antenna && cos.antenna !== 'none') {
    const ant = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.42, 6), new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.8, roughness: 0.3 }));
    stick.position.y = 0.21; ant.add(stick);
    let tip;
    if (cos.antenna === 'orb') tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: team }));
    else if (cos.antenna === 'flag') { tip = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.09), new THREE.MeshStandardMaterial({ color: cos.accent, side: THREE.DoubleSide })); tip.rotation.y = Math.PI / 2; tip.position.z = -0.08; }
    else if (cos.antenna === 'star') tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.5 }));
    else tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), new THREE.MeshBasicMaterial({ color: 0x60a5fa }));
    tip.position.y += 0.42; ant.add(tip);
    ant.position.set(-halfW * 0.55, def.stations[def.stations.length - 3][2], rearZ + 0.18);
    body.add(ant);
  }
  if (cos.topper === 'halo') { const hh = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 8, 28), new THREE.MeshBasicMaterial({ color: 0xfde68a })); hh.rotation.x = Math.PI / 2; hh.position.set(0, roofTop + 0.15, roofZ); hh.userData.dynamic = true; body.add(hh); root.userData.halo = hh; }
  else if (cos.topper === 'fin') { const sh = new THREE.Shape(); sh.moveTo(0.1, 0); sh.lineTo(-0.12, 0.13); sh.lineTo(-0.14, 0); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }); g.rotateY(-Math.PI / 2); const m = new THREE.Mesh(g, accent); m.position.set(0.01, roofTop, roofZ); body.add(m); }
  else if (cos.topper === 'cone') { const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xf97316 })); c.position.set(0, roofTop + 0.12, roofZ); body.add(c); }
  else if (cos.topper === 'spikes') { for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.2 })); const a = (i / 5) * Math.PI * 2; c.position.set(Math.cos(a) * 0.1, roofTop + 0.06, roofZ + Math.sin(a) * 0.1); body.add(c); } }

  // ---- underglow
  const glowColor = cos.glow === 'team' ? teamColor.main : GLOW_COLORS[cos.glow];
  if (glowColor !== undefined && cos.glow !== 'none') {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowColor, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    gl.rotation.x = -Math.PI / 2; gl.position.y = GROUND + 0.02; root.add(gl);
  }

  // ---- twin boost nozzles + flames (flames are dynamic)
  const flames = [];
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const coreMat = new THREE.MeshBasicMaterial({ color: 0x223344 });
  const nozX = def.openWheel ? [0] : [-0.13, 0.13];
  for (const x of nozX) {
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.08, 16, 1, true), S.nozzle);
    noz.rotation.x = Math.PI / 2; noz.position.set(x, -0.1, rearZ + 0.01); body.add(noz);
    const core = new THREE.Mesh(new THREE.CircleGeometry(0.04, 16), coreMat); core.position.set(x, -0.1, rearZ + 0.02); core.rotation.y = Math.PI; core.userData.dynamic = true; body.add(core);
    const fl = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.42, 12, 1, true), flameMat);
    fl.rotation.x = -Math.PI / 2; fl.position.set(x, -0.1, rearZ - 0.22); fl.visible = false; fl.userData.dynamic = true;
    body.add(fl); flames.push(fl);
  }

  // collapse static parts into a handful of draw calls
  mergeByMaterial(body, { castShadow: true });
  for (const w of wheels) mergeByMaterial(w.userData.spin);

  root.userData.body = body;
  root.userData.wheels = wheels;
  root.userData.flames = flames;
  root.userData.flame = flames[0];
  root.userData.flameMat = flameMat;
  root.userData.coreMat = coreMat;
  root.userData.cos = cos;
  root.userData.nozzleZ = rearZ;
  return root;
}

export function disposeObject(obj) {
  const keep = new Set(_shared ? Object.values(_shared) : []);
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (keep.has(m)) return; if (m.map && m.map !== glowTexture.t) m.map.dispose(); m.dispose(); });
  });
}
