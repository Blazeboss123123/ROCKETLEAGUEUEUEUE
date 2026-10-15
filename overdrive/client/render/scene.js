// GameRenderer: owns the three.js renderer, the arena, ball, cars, pads and effects.
import * as THREE from 'three';
import { buildArena, ARENA_THEMES } from './arenaMesh.js';
import { buildCar, disposeObject, glowTexture } from './carMesh.js';
import { Particles, Rings, goalExplosion } from './effects.js';
import { CameraRig } from '../camera.js';
import { PostFX } from './post.js';
import { BALL } from '../../shared/config.js';

let _blobGeo = null, _blobTex = null;
// soft dark ellipse under each car (contact shadow / ambient occlusion)
function blobTexture() {
  if (_blobTex) return _blobTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const rg = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  rg.addColorStop(0, 'rgba(0,0,0,0.85)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.45)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 128, 128);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

const PAD_PARTS = ['sDecal', 'lDecal', 'sBase', 'lBase', 'sOrb', 'lOrb', 'sBeam', 'lBeam', 'lRing'];

// Vertex-colour gradient along an axis (top colour -> bottom colour).
function gradientGeo(geo, top, bottom, axis = 'y') {
  geo.computeBoundingBox();
  const bb = geo.boundingBox, lo = bb.min[axis], hi = bb.max[axis];
  const p = geo.attributes.position, cols = new Float32Array(p.count * 3);
  const a = new THREE.Color(top), b = new THREE.Color(bottom), c = new THREE.Color();
  const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  for (let i = 0; i < p.count; i++) {
    const k = hi > lo ? (p.getComponent(i, ax) - lo) / (hi - lo) : 1;
    c.copy(b).lerp(a, k); cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function padTextures() {
  const decal = (S, ticks) => {
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), m = S / 2;
    const rg = g.createRadialGradient(m, m, 0, m, m, m);
    rg.addColorStop(0, 'rgba(255,248,214,0.95)'); rg.addColorStop(0.22, 'rgba(255,214,102,0.9)'); rg.addColorStop(0.5, 'rgba(255,146,30,0.6)');
    rg.addColorStop(0.74, 'rgba(255,84,0,0.16)'); rg.addColorStop(0.84, 'rgba(255,196,84,0.95)'); rg.addColorStop(0.9, 'rgba(255,120,20,0.45)'); rg.addColorStop(1, 'rgba(255,90,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,240,190,0.8)'; g.lineWidth = S / 64;
    for (let i = 0; i < ticks; i++) { const a = (i / ticks) * Math.PI * 2; g.beginPath(); g.moveTo(m + Math.cos(a) * m * 0.58, m + Math.sin(a) * m * 0.58); g.lineTo(m + Math.cos(a) * m * 0.7, m + Math.sin(a) * m * 0.7); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const bc = document.createElement('canvas'); bc.width = 8; bc.height = 256;
  const bg = bc.getContext('2d');
  const lg = bg.createLinearGradient(0, 0, 0, 256);
  lg.addColorStop(0, 'rgba(255,120,20,0)'); lg.addColorStop(0.45, 'rgba(255,140,30,0.18)'); lg.addColorStop(0.85, 'rgba(255,196,80,0.55)'); lg.addColorStop(1, 'rgba(255,240,180,0.9)');
  bg.fillStyle = lg; bg.fillRect(0, 0, 8, 256);
  const beam = new THREE.CanvasTexture(bc); beam.colorSpace = THREE.SRGBColorSpace;
  return { decalSmall: decal(128, 6), decalLarge: decal(256, 12), beam };
}

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _a = new THREE.Vector3(), _q2 = new THREE.Quaternion();

function ballTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9ced8'; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#4b5563'; g.lineWidth = 3;
  const R = 22;
  for (let row = 0; row < 8; row++) for (let col = 0; col < 14; col++) {
    const cx = col * R * 1.75 + (row % 2) * R * 0.875, cy = row * R * 1.5 + 8;
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); }
    g.closePath();
    g.fillStyle = (row + col) % 5 === 0 ? '#9aa3b2' : '#e5e7eb';
    g.fill(); g.stroke();
  }
  // equator band
  g.fillStyle = '#334155'; g.fillRect(0, 122, 512, 12);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function nameSprite(text, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '600 30px "Chakra Petch", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(250, g.measureText(text).width + 28);
  g.fillStyle = 'rgba(5,8,15,0.72)';
  g.beginPath(); g.roundRect(128 - w / 2, 10, w, 44, 10); g.fill();
  g.fillStyle = color; g.fillRect(128 - w / 2, 50, w, 4);
  g.fillStyle = '#f8fafc'; g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.6, 0.4, 1); s.renderOrder = 10;
  return s;
}

// Procedural studio environment for reflections (no external HDR files).
function makeEnvironment(renderer) {
  const env = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ float t = vP.y*0.5+0.5; vec3 c = mix(vec3(0.02,0.025,0.04), vec3(0.35,0.42,0.55), smoothstep(0.35,1.0,t)); c += vec3(0.08,0.1,0.14)*smoothstep(0.55,0.5,abs(t-0.52)); gl_FragColor = vec4(c,1.0); }',
  }));
  env.add(sky);
  const panel = (w, hgt, x, y, z, col, inten) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(inten), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m);
  };
  panel(30, 6, 0, 30, 0, 0xffffff, 3.5);
  panel(14, 30, -35, 8, 10, 0xbfd6ff, 1.6);
  panel(14, 30, 35, 8, -10, 0xffe2c2, 1.4);
  panel(40, 3, 0, 4, -40, 0x5ee1ff, 1.2);
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(env, 0.03).texture;
  pm.dispose();
  return tex;
}

export class GameRenderer {
  constructor(container, settings) {
    this.container = container;
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: settings.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = settings.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.prepend(this.renderer.domElement);
    this.renderer.domElement.className = 'game-canvas';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 900);
    this.cars = new Map(); // pid -> {obj, key, plate, wheelSpin}
    this.fx = new Particles(this.scene, settings.quality === 'low' ? 1500 : 4000);
    this.rings = new Rings(this.scene);
    this.flash = new THREE.PointLight(0xffffff, 0, 60, 1.5);
    this.scene.add(this.flash);
    // ball
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(BALL.radius, 4), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.45, metalness: 0.15, emissive: 0x1e293b, emissiveIntensity: 0.3 }));
    this.ball.castShadow = true;
    this.scene.add(this.ball);
    this.ballOutline = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius * 1.08, 24, 16), new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.BackSide, transparent: true, opacity: 0.9 }));
    this.ballOutline.visible = false;
    this.scene.add(this.ballOutline);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(BALL.radius, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.ballShadow.renderOrder = 1;
    this.scene.add(this.ballShadow);
    this.ballQuat = new THREE.Quaternion();
    this.arenaObj = null;
    this.rig = null;
    this.time = 0;
    this.post = new PostFX(this.renderer);
    this.envMap = makeEnvironment(this.renderer);
    this.scene.environment = this.envMap;
    this.initShowroom();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------- showroom (menus and garage) ----------------
  initShowroom() {
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x060910);
    sc.fog = new THREE.Fog(0x060910, 9, 26);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x0b0f1a, roughness: 0.35, metalness: 0.6 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.4, 0.08, 64), new THREE.MeshStandardMaterial({ color: 0x141a2a, roughness: 0.25, metalness: 0.8 }));
    deck.position.y = 0.04; deck.receiveShadow = true; sc.add(deck);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.35, 0.025, 8, 96), new THREE.MeshBasicMaterial({ color: 0x5ee1ff }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.085; sc.add(ring);
    const grid = new THREE.GridHelper(40, 40, 0x1e293b, 0x111827); grid.position.y = 0.002; sc.add(grid);
    sc.add(new THREE.HemisphereLight(0xbcd4ff, 0x05070d, 0.5));
    const key = new THREE.SpotLight(0xffffff, 60, 20, 0.6, 0.5, 1.2); key.position.set(2, 6, 3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); sc.add(key); sc.add(key.target);
    const rimB = new THREE.PointLight(0x2f7dff, 12, 12); rimB.position.set(-4, 1.5, -2); sc.add(rimB);
    const rimO = new THREE.PointLight(0xff8a1f, 12, 12); rimO.position.set(4, 1.5, -2); sc.add(rimO);
    sc.environment = this.envMap;
    const cam = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 100);
    this.showroom = { scene: sc, cam, car: null, yaw: 0.6, pitch: 0.18, zoom: 1, auto: true, shift: 0, deck, ring, key: '', fx: new Particles(sc, 1500), rings: new Rings(sc), t: 0 };
    this.showroom.fx.setPixelScale(800);
  }

  setShowroomCar(cos, team) {
    const sr = this.showroom;
    const key = JSON.stringify([cos, team]);
    if (sr.key === key && sr.car) return;
    sr.key = key;
    if (sr.car) { sr.scene.remove(sr.car); disposeObject(sr.car); }
    const colors = this.colors || [{ main: 0x2f7dff, light: 0x7fb4ff, css: '#2f7dff' }, { main: 0xff8a1f, light: 0xffc078, css: '#ff8a1f' }];
    sr.car = buildCar(cos, colors[team] || colors[0]);
    sr.car.position.y = 0.36 + 0.08;
    sr.car.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    sr.scene.add(sr.car);
    sr.team = team;
  }

  showroomBurst(style, team) {
    const sr = this.showroom;
    const colors = this.colors || [{ main: 0x2f7dff, light: 0x7fb4ff }, { main: 0xff8a1f, light: 0xffc078 }];
    goalExplosion(sr.fx, sr.rings, null, style, new THREE.Vector3(0, 1.4, -1.5), colors[team] || colors[0]);
  }

  drawShowroom(dt) {
    const sr = this.showroom;
    sr.t += dt;
    if (sr.auto) sr.yaw += dt * 0.25;
    const d = 4.6 * sr.zoom;
    const cam = sr.cam;
    const w = this.container.clientWidth || window.innerWidth, hh = this.container.clientHeight || window.innerHeight;
    cam.aspect = w / hh; cam.updateProjectionMatrix();
    cam.position.set(Math.sin(sr.yaw) * Math.cos(sr.pitch) * d, 0.5 + Math.sin(sr.pitch) * d, Math.cos(sr.yaw) * Math.cos(sr.pitch) * d);
    _v.set(0, 0.5, 0);
    cam.lookAt(_v);
    if (sr.shift) { cam.setViewOffset(w, hh, -w * sr.shift, 0, w, hh); } else cam.clearViewOffset();
    if (sr.car) {
      for (const wh of sr.car.userData.wheels) wh.userData.spin.rotation.x += dt * 1.5;
      if (sr.car.userData.halo) sr.car.userData.halo.rotation.z += dt;
    }
    sr.ring.material.color.setHSL(0.53 + Math.sin(sr.t * 0.5) * 0.03, 1, 0.68);
    sr.fx.update(dt); sr.rings.update(dt);
    this.renderView(sr.scene, cam, dt, { bloom: 0.5, threshold: 1.5, exposure: 0.85, vignette: 0.5 });
  }

  usePost() { return this.settings.postFx !== false && this.settings.quality !== 'low'; }
  renderView(scene, camera, dt, look) {
    if (this.usePost()) this.post.render(scene, camera, dt, look);
    else this.renderer.render(scene, camera);
  }

  // Reflections that match the arena: capture the built arena into a prefiltered environment map
  // (from a point above the centre spot) and use it for every PBR material in the scene.
  captureEnvironment() {
    if (this.arenaEnv) { this.arenaEnv.dispose(); this.arenaEnv = null; }
    const g = this.arenaObj.group;
    const pads = this.padField ? PAD_PARTS.map((k) => this.padField[k]) : [];
    for (const m of pads) m.visible = false;
    const hidden = [this.ball, this.ballShadow, this.ballOutline].filter((o) => o.visible);
    for (const o of hidden) o.visible = false;
    g.position.y -= 7; g.updateMatrixWorld(true);
    const pm = new THREE.PMREMGenerator(this.renderer);
    try { this.arenaEnv = pm.fromScene(this.scene, 0.015, 0.1, 1200); } catch { this.arenaEnv = null; }
    pm.dispose();
    g.position.y += 7; g.updateMatrixWorld(true);
    for (const m of pads) m.visible = true;
    for (const o of hidden) o.visible = true;
    // ambient image lighting stays on the bright studio map; the arena capture is used as the
    // reflection source for car paint, glass and rims (see syncCars)
    this.scene.environment = this.envMap;
  }

  applyQuality(q) {
    const s = this.settings;
    const pr = Math.min(window.devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1) * (s.renderScale || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q !== 'low';
    this.fx.scale = q === 'low' ? 0.4 : q === 'medium' ? 0.7 : 1;
    this.resize();
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setPixelScale(h * this.renderer.getPixelRatio());
  }

  setArena(arena, themeId, colors) {
    if (this.arenaObj) { this.scene.remove(this.arenaObj.group); disposeObject(this.arenaObj.group); }
    this.disposePads();
    this.arena = arena;
    this.colors = colors;
    this.themeId = themeId;
    this.arenaObj = buildArena(arena, themeId, colors, this.settings.quality);
    this.scene.add(this.arenaObj.group);
    const th = this.arenaObj.theme;
    this.scene.background = new THREE.Color(th.sky.horizon);
    this.scene.fog = new THREE.Fog(th.fog, ...(th.fogRange || [140, 520]));
    this.buildPads(arena.pads);
    this.captureEnvironment();
    this.rig = new CameraRig(this.camera, arena);
    this.clearCars();
  }

  // Boost pads as instanced meshes (a few draw calls for all pads). Gradient decals on the
  // floor, gradient-shaded plates and orbs, and a fading light column over every pad.
  buildPads(pads) {
    const mk = (geo, mat, list, order = 0) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.renderOrder = order; this.scene.add(m); return m; };
    const small = pads.filter((p) => !p.large), large = pads.filter((p) => p.large);
    const T = padTextures();
    const plateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.55 });
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    const decalMat = (map) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const beamMat = new THREE.MeshBasicMaterial({ map: T.beam, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true });
    const P = {
      pads, small, large, T,
      sDecal: mk(new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2), decalMat(T.decalSmall), small, 1),
      lDecal: mk(new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2), decalMat(T.decalLarge), large, 1),
      sBase: mk(gradientGeo(new THREE.CylinderGeometry(0.5, 0.62, 0.1, 6), 0xfff2c4, 0x7a3a06), plateMat, small),
      lBase: mk(gradientGeo(new THREE.CylinderGeometry(1.0, 1.18, 0.14, 32), 0xfff2c4, 0x7a3a06), plateMat, large),
      sOrb: mk(gradientGeo(new THREE.OctahedronGeometry(0.2, 1), 0xfffbe6, 0xff7a00), orbMat, small),
      lOrb: mk(gradientGeo(new THREE.IcosahedronGeometry(0.5, 2), 0xfffbe6, 0xff6a00), orbMat, large),
      sBeam: mk(new THREE.CylinderGeometry(0.42, 0.5, 0.9, 20, 1, true).translate(0, 0.45, 0), beamMat, small, 3),
      lBeam: mk(new THREE.CylinderGeometry(0.95, 1.05, 3.4, 32, 1, true).translate(0, 1.7, 0), beamMat, large, 3),
      lRing: mk(gradientGeo(new THREE.TorusGeometry(0.85, 0.05, 8, 40).rotateX(Math.PI / 2), 0xffe08a, 0xff5a00, 'x'), ringMat, large),
      m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(),
    };
    this.padField = P;
    this.updatePads(null, 0);
  }
  disposePads() {
    const P = this.padField; if (!P) return;
    for (const k of PAD_PARTS) { this.scene.remove(P[k]); P[k].geometry.dispose(); }
    for (const t of Object.values(P.T)) t.dispose();
    this.padField = null;
  }
  updatePads(timers, t) {
    const P = this.padField; if (!P) return;
    const { m, q, v, s, c } = P;
    const put = (mesh, i, x, y, z, sc, color, rot) => {
      if (rot) q.setFromAxisAngle(v.set(0, 1, 0), rot); else q.identity();
      m.compose(v.set(x, y, z), q, s.set(sc, sc, sc)); mesh.setMatrixAt(i, m);
      if (color !== undefined) mesh.setColorAt(i, c.set(color));
    };
    const each = (list, large) => list.forEach((p, i) => {
      const idx = P.pads.indexOf(p);
      const on = !(timers && timers[idx] > 0);
      const pulse = 0.85 + Math.sin(t * 3 + idx) * 0.15;
      put(large ? P.lDecal : P.sDecal, i, p.x, 0.02, p.z, 1, on ? c.setScalar(pulse).getHex() : 0x2a2e36);
      put(large ? P.lBase : P.sBase, i, p.x, 0.05, p.z, 1, on ? 0xffffff : 0x3a3f4b, large ? 0 : Math.PI / 6);
      put(large ? P.lOrb : P.sOrb, i, p.x, (large ? 1.15 : 0.42) + Math.sin(t * 2 + idx) * 0.07, p.z, on ? 1 : 0, 0xffffff, t * (large ? 0.8 : 1.6) + idx);
      put(large ? P.lBeam : P.sBeam, i, p.x, 0.06, p.z, on ? 1 : 0, c.setScalar(0.7 + Math.sin(t * 4 + idx) * 0.3).getHex(), -t * 0.5);
      if (large) put(P.lRing, i, p.x, 1.15 + Math.sin(t * 2 + idx) * 0.07, p.z, on ? 1 : 0, 0xffffff, t + idx);
    });
    each(P.small, false);
    each(P.large, true);
    for (const k of PAD_PARTS) { P[k].instanceMatrix.needsUpdate = true; if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true; }
  }

  clearCars() { for (const c of this.cars.values()) { this.scene.remove(c.obj); disposeObject(c.obj); } this.cars.clear(); }

  // roster: [{pid, name, team, cos}]
  syncCars(roster, myPid) {
    const seen = new Set();
    for (const r of roster) {
      seen.add(r.pid);
      const key = JSON.stringify([r.team, r.cos, r.name, r.pid === myPid]);
      const cur = this.cars.get(r.pid);
      if (cur && cur.key === key) continue;
      if (cur) { this.scene.remove(cur.obj); disposeObject(cur.obj); }
      const col = this.colors[r.team] || this.colors[0];
      const obj = buildCar(r.cos, col);
      let plate = null;
      if (r.pid !== myPid) { plate = nameSprite(r.name || '?', col.css); obj.add(plate); plate.position.set(0, 1.25, 0); plate.userData.keepUpright = true; }
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = this.settings.quality === 'high';
        const m = o.material;
        if (this.arenaEnv && m && m.isMeshStandardMaterial && (m.metalness > 0.2 || m.clearcoat > 0)) { m.envMap = this.arenaEnv.texture; m.envMapIntensity = 1.6; m.needsUpdate = true; }
      });
      const blob = new THREE.Mesh(_blobGeo || (_blobGeo = new THREE.PlaneGeometry(2.6, 3.4).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4 }));
      blob.position.y = -0.33; blob.renderOrder = 1; blob.userData.contact = true; obj.add(blob);
      this.scene.add(obj);
      this.cars.set(r.pid, { obj, key, plate, trail: r.cos?.trail || 'ion', team: r.team, spin: 0 });
    }
    for (const [pid, c] of this.cars) if (!seen.has(pid)) { this.scene.remove(c.obj); disposeObject(c.obj); this.cars.delete(pid); }
  }

  // view: { cars: [{id, team, pos, quat, vel, onGround, boosting}], ball: {pos, vel, angVel, hidden}, pads: timers[] }
  draw(view, dt) {
    this.time += dt;
    const s = this.settings;
    for (const c of view.cars) {
      const rc = this.cars.get(c.id);
      if (!rc) continue;
      rc.obj.position.copy(c.pos);
      rc.obj.quaternion.copy(c.quat);
      rc.obj.visible = !c.hidden;
      if (c.hidden) { if (rc.plate) rc.plate.visible = false; rc.prevVel = null; continue; }
      const ud = rc.obj.userData;
      // wheels spin with forward speed, front wheels steer
      const fwdSpeed = c.fwdSpeed || 0;
      rc.spin += fwdSpeed * dt / (ud.wheels[0]?.userData.r || 0.19);
      for (const w of ud.wheels) {
        w.userData.spin.rotation.x = rc.spin;
        if (w.userData.front) w.rotation.y = -(c.steer || 0) * 0.42;
      }
      // body lean: squat under acceleration, dive under braking, roll out of corners (visual only)
      if (c.vel && dt > 0) {
        if (!rc.prevVel) rc.prevVel = c.vel.clone();
        _a.subVectors(c.vel, rc.prevVel).divideScalar(dt);
        rc.prevVel.copy(c.vel);
        _q2.copy(c.quat).invert();
        _a.applyQuaternion(_q2); // local acceleration: x = left, z = forward
        const tp = c.onGround ? Math.max(-0.07, Math.min(0.07, -_a.z * 0.004)) : 0;
        const tr = c.onGround ? Math.max(-0.09, Math.min(0.09, _a.x * 0.0045)) : 0;
        rc.pitch = (rc.pitch || 0) + (tp - (rc.pitch || 0)) * Math.min(1, dt * 7);
        rc.roll = (rc.roll || 0) + (tr - (rc.roll || 0)) * Math.min(1, dt * 7);
        ud.body.rotation.set(rc.pitch, 0, rc.roll);
      }
      const boosting = !!c.boosting;
      const flameCol = rc.trail === 'ember' ? 0xffa040 : rc.trail === 'vapour' ? 0xe5e7eb : rc.trail === 'prism' ? 0xf0abfc : rc.trail === 'aurora' ? 0x6ee7b7 : rc.trail === 'arc' ? 0xe0f2fe : 0x93c5fd;
      for (const fl of ud.flames) { fl.visible = boosting; if (boosting) fl.scale.set(1, 0.75 + Math.random() * 0.55, 1); }
      ud.coreMat.color.set(boosting ? flameCol : 0x1c2430);
      if (boosting) {
        ud.flameMat.color.set(flameCol);
        _v.set(0, -0.1, (ud.nozzleZ || -0.7) - 0.05).applyQuaternion(c.quat).add(c.pos);
        const back = _p.set(0, 0, 1).applyQuaternion(c.quat);
        this.fx.trail(rc.trail, _v.x, _v.y, _v.z, back.x, back.y, back.z, c.vel?.x || 0, c.vel?.y || 0, c.vel?.z || 0, dt, this.time);
      }
      if (c.supersonic) {
        // supersonic: thin white wake streaming off the car
        _v.set((Math.random() - 0.5) * 0.8, 0.05 + Math.random() * 0.25, (ud.nozzleZ || -0.7)).applyQuaternion(c.quat).add(c.pos);
        const back = _p.set(0, 0, 1).applyQuaternion(c.quat);
        this.fx.trail('supersonic', _v.x, _v.y, _v.z, back.x, back.y, back.z, 0, 0, 0, dt, this.time);
      }
      if (rc.obj.userData.halo) rc.obj.userData.halo.rotation.z += dt;
      if (rc.plate) rc.plate.visible = !!s.nameplates && !c.hidden;
      const blob = rc.obj.children.find((o) => o.userData.contact);
      if (blob) blob.material.opacity += ((c.onGround ? 0.75 : 0) - blob.material.opacity) * Math.min(1, dt * 12);
    }
    // ball
    const b = view.ball;
    this.ball.visible = !b.hidden;
    this.ballShadow.visible = !b.hidden;
    if (!b.hidden) {
      this.ball.position.copy(b.pos);
      if (b.angVel) {
        const w = b.angVel, wl = Math.hypot(w.x, w.y, w.z);
        if (wl > 1e-4) { _q.setFromAxisAngle(_v.set(w.x / wl, w.y / wl, w.z / wl), wl * dt); this.ballQuat.premultiply(_q); }
      }
      this.ball.quaternion.copy(this.ballQuat);
      const h = Math.max(0, b.pos.y - BALL.radius);
      this.ballShadow.position.set(b.pos.x, 0.02, b.pos.z);
      this.ballShadow.scale.setScalar(Math.max(0.35, 1 - h * 0.03));
      this.ballShadow.material.opacity = Math.max(0.12, 0.55 - h * 0.02);
      this.ballOutline.visible = !!s.ballOutline;
      this.ballOutline.position.copy(b.pos);
    } else this.ballOutline.visible = false;
    // dropshot: ball glows in the charging team's colour, brighter per charge level
    const bm = this.ball.material;
    if (view.drop && view.drop.active && view.drop.team >= 0) {
      bm.emissive.set((this.colors[view.drop.team] || this.colors[0]).main);
      bm.emissiveIntensity = [0, 0.45, 1.1, 2.2][view.drop.level] * (0.85 + Math.sin(this.time * (4 + view.drop.level * 3)) * 0.15);
    } else if (bm.emissiveIntensity !== 0.3) { bm.emissive.set(0x1e293b); bm.emissiveIntensity = 0.3; }
    // pads, tiles, animated scenery
    if (view.pads) this.updatePads(view.pads, this.time);
    if (this.arenaObj?.setTiles) this.arenaObj.setTiles(view.tiles || null, this.time);
    this.arenaObj?.update(dt, this.time);
    this.fx.update(dt);
    this.rings.update(dt);
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 900);
    const look = this.arenaObj?.theme.look || {};
    const sp = this.rig?.speed || 0;
    this.renderView(this.scene, this.camera, dt, { ...look, fringe: s.speedFx !== false ? Math.min(1, Math.max(0, (sp - 18) / 6)) * 0.02 : 0 });
  }

  goal(pos, team, styleId) {
    const col = this.colors[team] || this.colors[0];
    goalExplosion(this.fx, this.rings, this.flash, styleId, new THREE.Vector3(pos.x, pos.y, pos.z), col);
  }
  impact(pos, strength) {
    const n = Math.min(40, 6 + strength * 2);
    this.fx.burst(pos.x, pos.y, pos.z, n, 4 + strength * 0.4, 0.35, 0.14, [0xffffff, 0xfde68a], { endSize: 0.03 });
  }
  pickup(pos, large) {
    this.fx.burst(pos.x, pos.y + 0.4, pos.z, large ? 40 : 12, large ? 7 : 4, 0.5, 0.18, [0xffd27a, 0xffb020], { up: 2, endSize: 0.03 });
  }
  demolition(pos, team) {
    const col = this.colors[team] || this.colors[0];
    const P = new THREE.Vector3(pos.x, pos.y, pos.z);
    this.fx.burst(P.x, P.y, P.z, 160, 14, 0.9, 0.55, [0xfff1c1, 0xffb347, 0xff5a1f, col.light], { endSize: 0.1 });
    this.fx.burst(P.x, P.y, P.z, 50, 4, 1.8, 1.4, [0x3a3f4b, 0x6b7280], { alpha: 0.5, endSize: 2.4, up: 1.5 });
    this.fx.burst(P.x, P.y, P.z, 40, 9, 1.2, 0.14, [0x9ca3af, 0xe5e7eb], { gravity: -9, up: 4, shape: 1, endSize: 0.08 });
    this.rings.add(P, new THREE.Vector3(0, 1, 0), 0xffb347, 7, 0.5);
    this.flash.color.set(0xff8a3d); this.flash.position.copy(P); this.flash.intensity = 300;
  }
  respawnFx(pos, team) {
    const col = this.colors[team] || this.colors[0];
    this.fx.burst(pos.x, pos.y + 0.3, pos.z, 40, 3, 0.6, 0.2, [col.main, col.light, 0xffffff], { up: 2, endSize: 0.02 });
  }
  tileBreak(e) {
    const col = this.colors[e.team] || this.colors[0];
    const n = 30 + e.level * 30;
    this.fx.burst(e.x, 0.3, e.z, n, 5 + e.level * 2, 0.8, 0.22, [col.light, col.main, 0xffffff], { up: 4, endSize: 0.05 });
    this.rings.add(new THREE.Vector3(e.x, 0.2, e.z), new THREE.Vector3(0, 1, 0), col.main, 3 + e.level * 3, 0.45);
  }
  dust(pos) {
    this.fx.burst(pos.x, 0.15, pos.z, 10, 2.5, 0.6, 0.35, [0x9ca3af], { flat: true, alpha: 0.4, endSize: 0.6 });
  }
}

export { ARENA_THEMES };
