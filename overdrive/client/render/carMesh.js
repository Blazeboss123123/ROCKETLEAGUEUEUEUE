// Procedural, original car models. Every body shares the same gameplay hitbox; these are visuals only.
// Local frame matches the simulation: forward +Z, up +Y, left +X. Origin = car origin (0.36 m above ground).
import * as THREE from 'three';
import { DEFAULT_LOADOUT } from '../cosmetics.js';
import { mergeByMaterial } from './merge.js';

// Side profiles (z forward, y up) in metres relative to the car origin.
const PROFILES = {
  comet: {
    body: [[-0.66, -0.2], [0.62, -0.2], [0.68, -0.08], [0.62, 0.0], [0.25, 0.05], [-0.1, 0.17], [-0.48, 0.17], [-0.66, 0.08]],
    cabin: [[0.22, 0.05], [-0.06, 0.25], [-0.36, 0.25], [-0.5, 0.15]], width: 0.84, cabinWidth: 0.62, wheelR: 0.17, wheelZ: [0.4, -0.42], wheelX: 0.42,
  },
  strider: {
    body: [[-0.64, -0.2], [0.64, -0.2], [0.68, -0.06], [0.6, 0.03], [0.18, 0.08], [-0.42, 0.1], [-0.64, 0.06]],
    cabin: [[0.18, 0.08], [-0.02, 0.27], [-0.34, 0.28], [-0.5, 0.1]], width: 0.84, cabinWidth: 0.66, wheelR: 0.17, wheelZ: [0.41, -0.41], wheelX: 0.42,
  },
  rampart: {
    body: [[-0.62, -0.19], [0.6, -0.19], [0.66, -0.02], [0.56, 0.08], [0.1, 0.1], [-0.6, 0.12], [-0.64, 0.0]],
    cabin: [[0.1, 0.1], [0.0, 0.3], [-0.46, 0.3], [-0.56, 0.12]], width: 0.88, cabinWidth: 0.74, wheelR: 0.18, wheelZ: [0.4, -0.4], wheelX: 0.44,
  },
  vanta: {
    body: [[-0.7, -0.18], [0.66, -0.18], [0.74, -0.12], [0.5, 0.0], [0.05, 0.1], [-0.55, 0.14], [-0.72, 0.18], [-0.72, 0.05]],
    cabin: [[0.12, 0.08], [-0.1, 0.22], [-0.4, 0.2], [-0.5, 0.12]], width: 0.8, cabinWidth: 0.5, wheelR: 0.165, wheelZ: [0.43, -0.44], wheelX: 0.43,
  },
  wisp: {
    body: [[-0.62, -0.16], [0.7, -0.14], [0.72, -0.08], [0.3, 0.02], [-0.2, 0.12], [-0.52, 0.12], [-0.62, 0.0]],
    cabin: [[0.0, 0.08], [-0.12, 0.2], [-0.32, 0.2], [-0.4, 0.1]], width: 0.4, cabinWidth: 0.3, wheelR: 0.18, wheelZ: [0.46, -0.42], wheelX: 0.47, open: true,
  },
};

const WHEEL_COLORS = { chrome: 0xd4d4d8, black: 0x1f2937, gold: 0xd4a017, white: 0xf5f5f4 };
const GLOW_COLORS = { cyan: 0x22d3ee, magenta: 0xe879f9, lime: 0xa3e635 };

function shapeFrom(points) {
  const s = new THREE.Shape();
  points.forEach(([z, y], i) => (i ? s.lineTo(z, y) : s.moveTo(z, y)));
  s.closePath();
  return s;
}

function extrudeProfile(points, width, bevel) {
  const geo = new THREE.ExtrudeGeometry(shapeFrom(points), { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1, curveSegments: 4 });
  geo.rotateY(-Math.PI / 2);                // shape x (= car z) -> world z; extrusion -> world -x
  geo.translate((width - bevel * 2) / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

export function paintMaterial(color, finish) {
  if (finish === 'pearl') return new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 900] });
  if (finish === 'metal') return new THREE.MeshStandardMaterial({ color, roughness: 0.28, metalness: 0.85 });
  if (finish === 'matte') return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0 });
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.22, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.15 });
}

function buildWheel(style, r, rimColor, teamCol) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.14, 20), new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.95 }));
  tire.rotation.z = Math.PI / 2; g.add(tire);
  const rimMat = new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.25, metalness: 0.9 });
  const spin = new THREE.Group(); // rotates with the wheel
  const face = (mesh) => { mesh.position.x = 0.072; spin.add(mesh); const m2 = mesh.clone(); m2.position.x = -0.072; spin.add(m2); };
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.02, 12), rimMat); hub.rotation.z = Math.PI / 2; face(hub);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 0.72, r * 0.07, 6, 24), rimMat); ring.rotation.y = Math.PI / 2; face(ring);
  if (style === 'disc') {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.7, 0.012, 24), rimMat); d.rotation.z = Math.PI / 2; face(d);
  } else if (style === 'halo') {
    const glow = new THREE.Mesh(new THREE.TorusGeometry(r * 0.55, r * 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: teamCol }));
    glow.rotation.y = Math.PI / 2; face(glow);
  } else {
    const n = style === 'tri' ? 3 : style === 'turbine' ? 9 : style === 'mesh' ? 12 : 6;
    for (let i = 0; i < n; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.012, r * 0.7, style === 'tri' ? r * 0.28 : style === 'mesh' ? 0.012 : 0.04), rimMat);
      const a = (i / n) * Math.PI * 2;
      sp.position.set(0, Math.cos(a) * r * 0.36, Math.sin(a) * r * 0.36);
      sp.rotation.x = -a + (style === 'turbine' ? 0.5 : 0);
      face(sp);
    }
  }
  g.add(spin);
  g.userData.spin = spin;
  return g;
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
  const prof = PROFILES[cos.body] || PROFILES.strider;
  const team = new THREE.Color(teamColor.main);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = paintMaterial(new THREE.Color(cos.paint), cos.finish);
  const accentMat = paintMaterial(new THREE.Color(cos.accent), cos.finish === 'pearl' ? 'gloss' : cos.finish);
  const bodyMesh = new THREE.Mesh(extrudeProfile(prof.body, prof.width, 0.035), paint);
  bodyMesh.castShadow = true;
  body.add(bodyMesh);
  const glass = new THREE.Mesh(extrudeProfile(prof.cabin, prof.cabinWidth, 0.03), new THREE.MeshPhysicalMaterial({ color: 0x0b1220, roughness: 0.05, metalness: 0.4, clearcoat: 1 }));
  glass.castShadow = true;
  body.add(glass);
  // team identity: side stripe + rear light bar + nose light
  const teamMat = new THREE.MeshStandardMaterial({ color: team, emissive: team, emissiveIntensity: 0.9, roughness: 0.4 });
  const sideY = -0.08;
  for (const s of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.035, 1.0), teamMat);
    stripe.position.set(s * (prof.width / 2 + 0.004), sideY, 0); body.add(stripe);
  }
  const rear = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.8, 0.04, 0.02), teamMat);
  rear.position.set(0, prof.body.find((p) => p[0] < -0.5)?.[1] ?? 0, -0.66 - 0.04); rear.position.y = -0.02; body.add(rear);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), lightMat); l.position.set(s * prof.width * 0.3, -0.07, 0.69); body.add(l); }

  // open-wheel: side pods + wings in accent
  if (prof.open) {
    for (const s of [-1, 1]) { const pod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.5), accentMat); pod.position.set(s * 0.28, -0.1, -0.05); pod.castShadow = true; body.add(pod); }
    const fw = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.03, 0.14), accentMat); fw.position.set(0, -0.17, 0.66); body.add(fw);
    const rw = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.03, 0.16), accentMat); rw.position.set(0, 0.22, -0.6); body.add(rw);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.2, 0.08), accentMat); st.position.set(s * 0.3, 0.12, -0.58); body.add(st); }
  } else if (cos.body === 'vanta' || cos.body === 'comet') {
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(prof.width * 0.95, 0.025, 0.14), accentMat);
    spoiler.position.set(0, cos.body === 'vanta' ? 0.22 : 0.24, -0.6); body.add(spoiler);
  }

  // decals
  const topY = Math.max(...prof.body.map((p) => p[1]));
  if (cos.decal === 'stripe') {
    const sg = extrudeProfile(prof.body, Math.min(0.1, prof.width * 0.22), 0.004);
    for (const s of [-1, 1]) { const st = new THREE.Mesh(sg, accentMat); st.scale.set(1, 1.04, 1.012); st.position.set(s * prof.width * 0.13, 0.004, 0); body.add(st); }
  } else if (cos.decal === 'split') {
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(prof.width + 0.01, 0.07, 1.26), accentMat); skirt.position.set(0, -0.16, 0); body.add(skirt);
  } else if (cos.decal === 'hex') {
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.01, 6), accentMat);
      h.rotation.z = Math.PI / 2; h.position.set(s * (prof.width / 2 + 0.006), -0.12 + (i % 2) * 0.05, -0.25 + i * 0.13); body.add(h);
    }
  } else if (cos.decal === 'bolt') {
    for (const s of [-1, 1]) {
      const pts = [[0.4, -0.02], [0.1, -0.02], [0.16, -0.1], [-0.3, -0.1], [-0.05, -0.15], [-0.1, -0.06], [0.3, -0.06]];
      const sh = new THREE.Shape(); pts.forEach(([z, y], i) => (i ? sh.lineTo(z, y) : sh.moveTo(z, y)));
      const geo = new THREE.ShapeGeometry(sh); geo.rotateY(s * Math.PI / 2);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: cos.accent, side: THREE.DoubleSide, emissive: new THREE.Color(cos.accent), emissiveIntensity: 0.25 }));
      m.position.x = s * (prof.width / 2 + 0.008); body.add(m);
    }
  }

  // wheels
  const wheels = [];
  const rimCol = cos.wheelColor === 'team' ? teamColor.main : WHEEL_COLORS[cos.wheelColor] ?? 0xd4d4d8;
  for (const z of prof.wheelZ) for (const s of [-1, 1]) {
    const w = buildWheel(cos.wheels, prof.wheelR, rimCol, teamColor.main);
    w.position.set(s * prof.wheelX, -0.36 + prof.wheelR, z);
    w.userData.front = z > 0;
    w.userData.r = prof.wheelR;
    root.add(w); wheels.push(w);
  }

  // antenna
  if (cos.antenna && cos.antenna !== 'none') {
    const ant = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x9ca3af }));
    stick.position.y = 0.2; ant.add(stick);
    let tip;
    if (cos.antenna === 'orb') tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: team }));
    else if (cos.antenna === 'flag') { tip = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.09), new THREE.MeshStandardMaterial({ color: cos.accent, side: THREE.DoubleSide })); tip.rotation.y = Math.PI / 2; tip.position.z = -0.08; }
    else if (cos.antenna === 'star') tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.05), new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xfacc15, emissiveIntensity: 0.5 }));
    else tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.1, 4), new THREE.MeshBasicMaterial({ color: 0x60a5fa }));
    tip.position.y += 0.4; ant.add(tip);
    ant.position.set(-prof.width * 0.32, topY, -0.5);
    body.add(ant);
    root.userData.antenna = ant;
  }
  // topper
  const roofY = Math.max(...prof.cabin.map((p) => p[1]));
  const roofZ = prof.cabin.reduce((a, p) => a + p[0], 0) / prof.cabin.length;
  if (cos.topper === 'halo') { const h = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.015, 8, 28), new THREE.MeshBasicMaterial({ color: 0xfde68a })); h.rotation.x = Math.PI / 2; h.position.set(0, roofY + 0.15, roofZ); body.add(h); root.userData.halo = h; }
  else if (cos.topper === 'fin') { const sh = new THREE.Shape(); sh.moveTo(0.1, 0); sh.lineTo(-0.12, 0.13); sh.lineTo(-0.14, 0); sh.closePath(); const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false }); g.rotateY(-Math.PI / 2); const m = new THREE.Mesh(g, accentMat); m.position.set(0.01, roofY + 0.02, roofZ); body.add(m); }
  else if (cos.topper === 'cone') { const c = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 16), new THREE.MeshStandardMaterial({ color: 0xf97316 })); c.position.set(0, roofY + 0.13, roofZ); body.add(c); const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0xffffff })); b2.position.set(0, roofY + 0.1, roofZ); body.add(b2); }
  else if (cos.topper === 'spikes') { for (let i = 0; i < 5; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.12, 6), new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.9, roughness: 0.2 })); const a = (i / 5) * Math.PI * 2; c.position.set(Math.cos(a) * 0.1, roofY + 0.07, roofZ + Math.sin(a) * 0.1); body.add(c); } }

  // underglow
  const glowColor = cos.glow === 'team' ? teamColor.main : GLOW_COLORS[cos.glow];
  if (glowColor !== undefined && cos.glow !== 'none') {
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.9), new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowColor, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    gl.rotation.x = -Math.PI / 2; gl.position.y = -0.34; root.add(gl);
  }

  // boost nozzle + flame (driven by renderer)
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 12, 1, true), flameMat);
  flame.rotation.x = -Math.PI / 2; flame.position.set(0, -0.04, -0.92); flame.visible = false;
  body.add(flame);

  flame.userData.dynamic = true;
  if (root.userData.halo) root.userData.halo.userData.dynamic = true;
  // collapse static parts into a handful of draw calls
  mergeByMaterial(body, { castShadow: true });
  for (const w of wheels) mergeByMaterial(w.userData.spin);
  root.userData.wheels = wheels;
  root.userData.flame = flame;
  root.userData.flameMat = flameMat;
  root.userData.cos = cos;
  root.userData.nozzle = new THREE.Vector3(0, -0.04, -0.7);
  return root;
}

export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map && m.map !== glowTexture.t) m.map.dispose(); m.dispose(); });
  });
}
