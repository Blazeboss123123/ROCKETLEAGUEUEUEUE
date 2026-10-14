// Builds the visible arena from the same parameters as the collision SDF:
// a rounded-rectangle bowl with filleted floor/wall/ceiling transitions, two goal boxes with
// open mouths, floor markings, boost pads and a themed stadium shell around it.
import * as THREE from 'three';
import { TEAM_COLORS } from '../../shared/config.js';
import { mergeByMaterial } from './merge.js';

export const ARENA_THEMES = {
  stadium: {
    id: 'stadium', name: 'Overdrive Stadium', blurb: 'Night-time championship bowl. High-contrast, competitive standard.',
    sky: 0x05070d, fog: 0x070a14, floor: '#1b2f2a', floor2: '#17282a', line: 'rgba(235,245,255,0.85)', wall: [140, 170, 210], wallAlpha: [0.55, 0.10],
    hemi: [0x9fb8ff, 0x0d0f18, 0.75], sun: [0xffffff, 1.5], crowd: true, accent: 0x7dd3fc, standColor: 0x111827,
  },
  solstice: {
    id: 'solstice', name: 'Solstice Park', blurb: 'Open-air afternoon arena. Same competitive geometry, warm light.',
    sky: 0x9cc7e8, fog: 0xbcd6ea, floor: '#3d7a3a', floor2: '#367134', line: 'rgba(255,255,255,0.9)', wall: [235, 245, 255], wallAlpha: [0.5, 0.06],
    hemi: [0xdfefff, 0x4a5a3a, 1.0], sun: [0xfff2dd, 2.2], crowd: true, accent: 0xffffff, standColor: 0xc9ced6,
  },
  skyway: {
    id: 'skyway', name: 'Skyway (Experimental)', blurb: 'Casual-only layout: wider, taller, rounder corners. Not used in ranked-style play.',
    sky: 0x120a1f, fog: 0x1a0f2c, floor: '#24183a', floor2: '#201536', line: 'rgba(240,220,255,0.85)', wall: [190, 150, 255], wallAlpha: [0.5, 0.08],
    hemi: [0xd9c6ff, 0x120a1f, 0.8], sun: [0xf5e6ff, 1.3], crowd: false, accent: 0xc084fc, standColor: 0x1c1430,
    params: { width: 80, height: 30, cornerRadius: 22, wallCurve: 6 },
  },
};

// Plan outline of the bowl at a given inset (metres in from the outer wall).
function planSegments(a, b, Rc, gw) {
  const ax = a - Rc, bz = b - Rc, segs = [];
  const line = (xs, zFn, xFn, nx, nz, kind) => segs.push({ type: 'line', xs, zFn, xFn, nx, nz, kind });
  const linspace = (p, q, step) => { const n = Math.max(1, Math.round(Math.abs(q - p) / step)); const o = []; for (let i = 0; i <= n; i++) o.push(p + (q - p) * i / n); return o; };
  const concat = (...arrs) => arrs.reduce((acc, r, i) => acc.concat(i ? r.slice(1) : r), []);
  const endXs = concat(linspace(ax, gw, 1.2), linspace(gw, -gw, 1.0), linspace(-gw, -ax, 1.2));
  segs.push({ type: 'end', ts: endXs, z: b, nz: 1 });                          // +Z end wall (x from +ax to -ax)
  segs.push({ type: 'arc', cx: -ax, cz: bz, a0: Math.PI / 2, a1: Math.PI });
  segs.push({ type: 'side', ts: linspace(bz, -bz, 1.5), x: -a, nx: -1 });       // -X side
  segs.push({ type: 'arc', cx: -ax, cz: -bz, a0: Math.PI, a1: Math.PI * 1.5 });
  segs.push({ type: 'end', ts: endXs.slice().reverse(), z: -b, nz: -1 });     // -Z end wall
  segs.push({ type: 'arc', cx: ax, cz: -bz, a0: Math.PI * 1.5, a1: Math.PI * 2 });
  segs.push({ type: 'side', ts: linspace(-bz, bz, 1.5), x: a, nx: 1 });         // +X side
  segs.push({ type: 'arc', cx: ax, cz: bz, a0: 0, a1: Math.PI / 2 });
  void line;
  return segs;
}

// Columns around the perimeter: each column has outer point, outward normal, flags.
function perimeterColumns(arena) {
  const p = arena.p;
  const a = arena.halfW, b = arena.halfL, Rc = p.cornerRadius, gw = arena.goalHalfW;
  const cols = [];
  let u = 0, last = null;
  const push = (x, z, nx, nz, inMouth) => {
    if (last) u += Math.hypot(x - last.x, z - last.z);
    const c = { x, z, nx, nz, u, inMouth }; cols.push(c); last = c;
  };
  for (const s of planSegments(a, b, Rc, gw)) {
    if (s.type === 'end') s.ts.forEach((x, i) => { if (cols.length && i === 0) return; push(x, s.z, 0, s.nz, Math.abs(x) <= gw + 1e-6); });
    else if (s.type === 'side') s.ts.forEach((z, i) => { if (i === 0) return; push(s.x, z, s.nx, 0, false); });
    else {
      const n = Math.max(6, Math.round((s.a1 - s.a0) * Rc / 1.2));
      for (let i = 1; i <= n; i++) {
        const ang = s.a0 + (s.a1 - s.a0) * i / n;
        push(s.cx + Rc * Math.cos(ang), s.cz + Rc * Math.sin(ang), Math.cos(ang), Math.sin(ang), false);
      }
    }
  }
  return cols;
}

// Profile rows from floor fillet, up the wall, through the ceiling fillet: {inset, y}
function profileRows(arena) {
  const p = arena.p, r = p.wallCurve, H = p.height, gh = p.goalHeight;
  const rows = [];
  const K = 9;
  for (let i = 0; i <= K; i++) { const th = (Math.PI / 2) * i / K; rows.push({ d: r - r * Math.sin(th), y: r - r * Math.cos(th) }); }
  const wallYs = [];
  const n1 = Math.max(1, Math.round((gh - r) / 1.2));
  for (let i = 1; i <= n1; i++) wallYs.push(r + (gh - r) * i / n1);
  const n2 = Math.max(1, Math.round((H - r - gh) / 2));
  for (let i = 1; i <= n2; i++) wallYs.push(gh + (H - r - gh) * i / n2);
  for (const y of wallYs) rows.push({ d: 0, y });
  for (let i = 1; i <= K; i++) { const th = (Math.PI / 2) * i / K; rows.push({ d: r - r * Math.cos(th), y: H - r + r * Math.sin(th) }); }
  let v = 0;
  rows.forEach((row, i) => { if (i) v += Math.hypot(row.d - rows[i - 1].d, row.y - rows[i - 1].y); row.v = v; });
  return rows;
}

function insetPoint(col, d, Rc, arena) {
  // offset the outer perimeter point inward along its normal
  return { x: col.x - col.nx * d, z: col.z - col.nz * d };
}

function wallTexture(theme) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  const [r, gg, b] = theme.wall;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = `rgba(${r},${gg},${b},0.18)`; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = `rgba(${r},${gg},${b},0.75)`; g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 253, 253);
  g.strokeStyle = `rgba(${r},${gg},${b},0.25)`; g.lineWidth = 1;
  for (let i = 32; i < 256; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function floorTexture(arena, theme, colors) {
  const a = arena.halfW, b = arena.halfL;
  const W = 1024, Hh = Math.round(1024 * b / a);
  const c = document.createElement('canvas'); c.width = W; c.height = Hh;
  const g = c.getContext('2d');
  const sx = W / (2 * a), sz = Hh / (2 * b);
  const X = (x) => (x + a) * sx, Z = (z) => (b - z) * sz; // +z (orange) at top of texture
  // turf stripes
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? theme.floor : theme.floor2; g.fillRect(0, (Hh / 16) * i, W, Hh / 16 + 1); }
  // team halves tint
  const tint = (col, z0, z1) => { const grd = g.createLinearGradient(0, Z(z0), 0, Z(z1)); grd.addColorStop(0, col + '00'); grd.addColorStop(1, col + '30'); g.fillStyle = grd; g.fillRect(0, Math.min(Z(z0), Z(z1)), W, Math.abs(Z(z1) - Z(z0))); };
  tint(colors[1].css, 0, b); tint(colors[0].css, 0, -b);
  g.strokeStyle = theme.line; g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, Z(0)); g.lineTo(W, Z(0)); g.stroke();
  g.beginPath(); g.arc(X(0), Z(0), 10 * sx, 0, Math.PI * 2); g.stroke();
  g.fillStyle = theme.line; g.beginPath(); g.arc(X(0), Z(0), 9, 0, Math.PI * 2); g.fill();
  // goal areas
  const gw = arena.goalHalfW;
  for (const s of [1, -1]) {
    g.strokeStyle = theme.line; g.lineWidth = 5;
    g.strokeRect(X(-gw - 4), Math.min(Z(s * b), Z(s * (b - 9))), (2 * gw + 8) * sx, 9 * sz);
    g.beginPath(); g.arc(X(0), Z(s * (b - 9)), 6 * sx, s > 0 ? 0 : Math.PI, s > 0 ? Math.PI : Math.PI * 2); g.stroke();
    // goal line in team colour
    g.strokeStyle = colors[s > 0 ? 1 : 0].css; g.lineWidth = 10;
    g.beginPath(); g.moveTo(X(-gw), Z(s * b)); g.lineTo(X(gw), Z(s * b)); g.stroke();
  }
  // kickoff spawn markers
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const team of [0, 1]) for (const sp of arena.kickoffSpawns(team, 5, () => 0)) { g.beginPath(); g.arc(X(sp.pos.x), Z(sp.pos.z), 7, 0, Math.PI * 2); g.fill(); }
  // pad halos
  for (const p of arena.pads) {
    g.fillStyle = p.large ? 'rgba(255,190,60,0.35)' : 'rgba(255,210,120,0.22)';
    g.beginPath(); g.arc(X(p.x), Z(p.z), p.radius * sx, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function netTexture(color) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = color; g.lineWidth = 2.5; g.globalAlpha = 0.9;
  for (let i = 0; i <= 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i - 64, 128); g.stroke(); g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 128); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildArena(arena, themeId = 'stadium', colors = TEAM_COLORS, quality = 'high') {
  const theme = ARENA_THEMES[themeId] || ARENA_THEMES.stadium;
  const group = new THREE.Group();
  const p = arena.p, a = arena.halfW, b = arena.halfL, r = p.wallCurve, H = p.height, Rc = p.cornerRadius, gw = arena.goalHalfW, gh = p.goalHeight;

  // ---------- bowl shell ----------
  const cols = perimeterColumns(arena);
  const rows = profileRows(arena);
  const pos = [], uv = [], idx = [];
  const NC = cols.length, NR = rows.length;
  for (let i = 0; i < NC; i++) {
    for (let j = 0; j < NR; j++) {
      const pt = insetPoint(cols[i], rows[j].d, Rc, arena);
      pos.push(pt.x, rows[j].y, pt.z);
      uv.push(cols[i].u / 6, rows[j].v / 6);
    }
  }
  const vtx = (i, j) => (i % NC) * NR + j;
  for (let i = 0; i < NC; i++) {
    const i2 = (i + 1) % NC;
    for (let j = 0; j < NR - 1; j++) {
      // cut the goal mouth out of the end walls (and the floor fillet in front of it)
      if (cols[i].inMouth && cols[i2].inMouth && rows[j + 1].y <= gh + 1e-6) continue;
      idx.push(vtx(i, j), vtx(i2, j), vtx(i, j + 1), vtx(i2, j), vtx(i2, j + 1), vtx(i, j + 1));
    }
  }
  const shellGeo = new THREE.BufferGeometry();
  shellGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shellGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  shellGeo.setIndex(idx);
  shellGeo.computeVertexNormals();
  // per-vertex alpha via color attribute (solid low, glassy high)
  const colAttr = [];
  for (let i = 0; i < NC; i++) for (let j = 0; j < NR; j++) {
    const y = rows[j].y, t = Math.min(1, Math.max(0, (y - 1) / (H * 0.6)));
    const al = theme.wallAlpha[0] + (theme.wallAlpha[1] - theme.wallAlpha[0]) * t;
    colAttr.push(1, 1, 1, al);
  }
  shellGeo.setAttribute('color', new THREE.Float32BufferAttribute(colAttr, 4));
  const wallTex = wallTexture(theme);
  const shellMat = new THREE.MeshStandardMaterial({
    map: wallTex, transparent: true, vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.1,
    depthWrite: false, emissive: new THREE.Color(theme.accent), emissiveIntensity: 0.06,
  });
  const shell = new THREE.Mesh(shellGeo, shellMat);
  shell.renderOrder = 2;
  group.add(shell);

  // solid backing for the lower wall band so the bowl reads clearly at speed
  // (rendered as dark opaque behind the glass to avoid see-through confusion near the floor)

  // ---------- floor ----------
  const fs = roundedRectShape(a - r, b - r, Rc - r);
  const floorGeo = new THREE.ShapeGeometry(fs, 24);
  floorGeo.rotateX(-Math.PI / 2); // shape (x, y) -> (x, 0, -y)
  const fp = floorGeo.attributes.position, fuv = floorGeo.attributes.uv;
  for (let i = 0; i < fp.count; i++) fuv.setXY(i, (fp.getX(i) + a) / (2 * a), (fp.getZ(i) + b) / (2 * b));
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTexture(arena, theme, colors), roughness: 0.85, metalness: 0.0 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.receiveShadow = true;
  group.add(floor);

  // ---------- ceiling ----------
  const ceil = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(a - r, b - r, Rc - r), 12).rotateX(Math.PI / 2).translate(0, H, 0),
    new THREE.MeshBasicMaterial({ color: theme.accent, transparent: true, opacity: 0.035, side: THREE.DoubleSide, depthWrite: false }));
  group.add(ceil);

  // ---------- goals ----------
  for (const team of [0, 1]) {
    const s = team === 0 ? -1 : 1;
    const col = colors[team];
    const g = new THREE.Group();
    const depth = p.goalDepth;
    const netMat = new THREE.MeshStandardMaterial({ map: netTexture(col.css), transparent: true, side: THREE.DoubleSide, emissive: new THREE.Color(col.main), emissiveIntensity: 0.25, depthWrite: false, roughness: 0.6 });
    netMat.map.repeat.set(4, 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, gh), netMat); back.position.set(0, gh / 2, s * (b + depth));
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, depth), netMat); roof.rotation.x = Math.PI / 2; roof.position.set(0, gh, s * (b + depth / 2));
    const left = new THREE.Mesh(new THREE.PlaneGeometry(depth, gh), netMat); left.rotation.y = Math.PI / 2; left.position.set(-gw, gh / 2, s * (b + depth / 2));
    const right = left.clone(); right.position.x = gw;
    const gfloor = new THREE.Mesh(new THREE.PlaneGeometry(2 * gw, depth), new THREE.MeshStandardMaterial({ color: new THREE.Color(col.dark), roughness: 0.8, emissive: new THREE.Color(col.main), emissiveIntensity: 0.08 }));
    gfloor.rotation.x = -Math.PI / 2; gfloor.position.set(0, 0.005, s * (b + depth / 2));
    g.add(back, roof, left, right, gfloor);
    // frame
    const frameMat = new THREE.MeshStandardMaterial({ color: col.light, emissive: new THREE.Color(col.main), emissiveIntensity: 1.6, roughness: 0.3 });
    const postGeo = new THREE.CylinderGeometry(0.22, 0.22, gh, 12);
    for (const x of [-gw, gw]) { const post = new THREE.Mesh(postGeo, frameMat); post.position.set(x, gh / 2, s * b); g.add(post); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 2 * gw + 0.44, 12), frameMat); bar.rotation.z = Math.PI / 2; bar.position.set(0, gh, s * b); g.add(bar);
    // caps for the cut floor fillet beside the posts
    for (const x of [-gw, gw]) g.add(filletCap(r, x, s * b, s, theme));
    // team light
    const light = new THREE.PointLight(col.main, 60, 40, 1.6); light.position.set(0, gh * 0.8, s * (b - 2)); g.add(light);
    light.userData.dynamic = true;
    mergeByMaterial(g);
    group.add(g);
    // wall glow strip along the end wall (team identity)
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(2 * (a - Rc) + 6, 0.35), new THREE.MeshBasicMaterial({ color: col.main, transparent: true, opacity: 0.9 }));
    strip.position.set(0, gh + 1.6, s * (b - 0.02)); strip.rotation.y = s > 0 ? Math.PI : 0; group.add(strip);
  }

  // ---------- stadium surroundings ----------
  if (theme.crowd) group.add(buildStands(arena, theme, colors, quality));
  else group.add(buildSkyRing(arena, theme));

  // ---------- lights ----------
  const hemi = new THREE.HemisphereLight(theme.hemi[0], theme.hemi[1], theme.hemi[2]);
  group.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun[0], theme.sun[1]);
  sun.position.set(30, 80, 20);
  if (quality !== 'low') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = sun.shadow.camera; sc.left = -a - 5; sc.right = a + 5; sc.top = b + 12; sc.bottom = -b - 12; sc.near = 10; sc.far = 160;
    sun.shadow.bias = -0.0008;
  }
  group.add(sun);
  group.add(sun.target);
  return { group, theme, floorMat, shellMat };
}

function roundedRectShape(hx, hz, rc) {
  // shape in the (x, y) plane where shape y = -world z after rotateX(-90deg)
  const s = new THREE.Shape();
  rc = Math.max(0.01, rc);
  s.moveTo(-hx + rc, -hz);
  s.lineTo(hx - rc, -hz); s.absarc(hx - rc, -hz + rc, rc, -Math.PI / 2, 0, false);
  s.lineTo(hx, hz - rc); s.absarc(hx - rc, hz - rc, rc, 0, Math.PI / 2, false);
  s.lineTo(-hx + rc, hz); s.absarc(-hx + rc, hz - rc, rc, Math.PI / 2, Math.PI, false);
  s.lineTo(-hx, -hz + rc); s.absarc(-hx + rc, -hz + rc, rc, Math.PI, Math.PI * 1.5, false);
  return s;
}

function filletCap(r, x, zWall, s, theme) {
  // cross-section of the solid between floor fillet and wall corner, in the plane x = const
  const pts = [];
  const K = 9;
  for (let i = 0; i <= K; i++) { const th = (Math.PI / 2) * i / K; pts.push([r - r * Math.sin(th), r - r * Math.cos(th)]); }
  const verts = [x, 0, zWall]; // corner (inset 0, y 0)
  for (const [d, y] of pts) verts.push(x, y, zWall - s * d);
  const idx = [];
  for (let i = 1; i < pts.length; i++) idx.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(idx); geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.floor2), side: THREE.DoubleSide, roughness: 0.9 }));
}

function buildStands(arena, theme, colors, quality) {
  const g = new THREE.Group();
  const a = arena.halfW, b = arena.halfL, H = arena.p.height;
  const standMat = new THREE.MeshStandardMaterial({ color: theme.standColor, roughness: 0.9 });
  const tiers = 7;
  const crowdPositions = [];
  const sides = [
    { len: 2 * b, cx: a + 4, cz: 0, rot: 0 }, { len: 2 * b, cx: -a - 4, cz: 0, rot: Math.PI },
    { len: 2 * a, cx: 0, cz: b + arena.p.goalDepth + 4, rot: -Math.PI / 2 }, { len: 2 * a, cx: 0, cz: -b - arena.p.goalDepth - 4, rot: Math.PI / 2 },
  ];
  for (const sd of sides) {
    const grp = new THREE.Group();
    for (let t = 0; t < tiers; t++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3, 1.6, sd.len + 10), standMat);
      step.position.set(t * 3, 1 + t * 2.4, 0); grp.add(step);
      for (let k = -sd.len / 2; k < sd.len / 2; k += 1.4) crowdPositions.push({ grp, x: t * 3 - 0.3, y: 2.6 + t * 2.4, z: k + (Math.random() - 0.5) * 0.4, side: sd });
    }
    grp.position.set(sd.cx, 0, sd.cz); grp.rotation.y = sd.rot;
    g.add(grp);
  }
  // crowd as one instanced mesh
  const n = quality === 'low' ? Math.floor(crowdPositions.length / 3) : crowdPositions.length;
  const crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.6, 1.1, 0.6), new THREE.MeshStandardMaterial({ roughness: 1 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), c = new THREE.Color();
  const palette = [0xe5e7eb, 0x9ca3af, 0x374151, colors[0].main, colors[1].main, colors[0].light, colors[1].light];
  for (let i = 0; i < n; i++) {
    const cp = crowdPositions[Math.floor(i * crowdPositions.length / n)];
    v.set(cp.x, cp.y, cp.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), cp.side.rot).add(new THREE.Vector3(cp.side.cx, 0, cp.side.cz));
    sc.set(1, 0.8 + Math.random() * 0.4, 1);
    m.compose(v, q, sc);
    crowd.setMatrixAt(i, m);
    // fans lean towards the team at their end
    const zside = v.z > 10 ? 1 : v.z < -10 ? 0 : -1;
    let col = palette[Math.floor(Math.random() * 3)];
    if (zside >= 0 && Math.random() < 0.6) col = Math.random() < 0.5 ? colors[zside].main : colors[zside].light;
    crowd.setColorAt(i, c.set(col));
  }
  crowd.instanceMatrix.needsUpdate = true;
  g.add(crowd);
  mergeByMaterial(g, { receiveShadow: false });
  // light rigs
  const rigMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const x of [-a - 8, a + 8]) for (const z of [-b + 10, 0, b - 10]) {
    const rig = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 4), rigMat); rig.position.set(x, H + 8, z); g.add(rig);
  }
  mergeByMaterial(g);
  return g;
}

function buildSkyRing(arena, theme) {
  const g = new THREE.Group();
  const geo = new THREE.TorusGeometry(Math.max(arena.halfW, arena.halfL) + 30, 0.6, 8, 120);
  const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: theme.accent }));
  ring.rotation.x = Math.PI / 2; ring.position.y = arena.p.height + 6;
  g.add(ring);
  const ring2 = ring.clone(); ring2.scale.setScalar(1.15); ring2.position.y = -2; g.add(ring2);
  const stars = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 1500; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * Math.PI * 0.45; const R = 260; sp.push(R * Math.cos(th) * Math.sin(ph), R * Math.cos(ph) - 40, R * Math.sin(th) * Math.sin(ph)); }
  stars.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  g.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, sizeAttenuation: false })));
  return g;
}
