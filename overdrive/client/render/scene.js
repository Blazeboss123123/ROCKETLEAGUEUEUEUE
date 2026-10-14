// GameRenderer: owns the three.js renderer, the arena, ball, cars, pads and effects.
import * as THREE from 'three';
import { buildArena, ARENA_THEMES } from './arenaMesh.js';
import { buildCar, disposeObject, glowTexture } from './carMesh.js';
import { Particles, Rings, goalExplosion } from './effects.js';
import { CameraRig } from '../camera.js';
import { BALL } from '../../shared/config.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

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
    this.renderer.render(sr.scene, cam);
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
    this.scene.background = new THREE.Color(th.sky);
    this.scene.fog = new THREE.Fog(th.fog, 120, 340);
    this.buildPads(arena.pads);
    this.rig = new CameraRig(this.camera, arena);
    this.clearCars();
  }

  // Boost pads as instanced meshes (a few draw calls for all pads).
  buildPads(pads) {
    const mk = (geo, mat, list) => { const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length)); m.count = list.length; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.scene.add(m); return m; };
    const small = pads.filter((p) => !p.large), large = pads.filter((p) => p.large);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    const orbMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0xffffff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false });
    const P = {
      pads, small, large,
      sBase: mk(new THREE.CylinderGeometry(0.55, 0.65, 0.08, 20), baseMat, small), lBase: mk(new THREE.CylinderGeometry(1.0, 1.15, 0.08, 24), baseMat, large),
      sOrb: mk(new THREE.SphereGeometry(0.18, 12, 8), orbMat, small), lOrb: mk(new THREE.SphereGeometry(0.5, 16, 12), orbMat, large),
      sHalo: mk(new THREE.PlaneGeometry(1.3, 1.3).rotateX(-Math.PI / 2), haloMat, small), lHalo: mk(new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2), haloMat, large),
      lRing: mk(new THREE.TorusGeometry(0.85, 0.05, 8, 32).rotateX(Math.PI / 2), orbMat, large),
      m: new THREE.Matrix4(), q: new THREE.Quaternion(), v: new THREE.Vector3(), s: new THREE.Vector3(), c: new THREE.Color(),
    };
    for (const k of ['sBase', 'lBase', 'sOrb', 'lOrb', 'sHalo', 'lHalo', 'lRing']) P[k].frustumCulled = false;
    P.sHalo.renderOrder = 1; P.lHalo.renderOrder = 1;
    this.padField = P;
    this.updatePads(null, 0);
  }
  disposePads() {
    const P = this.padField; if (!P) return;
    for (const k of ['sBase', 'lBase', 'sOrb', 'lOrb', 'sHalo', 'lHalo', 'lRing']) { this.scene.remove(P[k]); P[k].geometry.dispose(); }
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
    const each = (list, base, orb, halo, ring, large) => list.forEach((p, i) => {
      const idx = P.pads.indexOf(p);
      const on = !(timers && timers[idx] > 0);
      const col = large ? 0xffb020 : 0xffd27a;
      put(base, i, p.x, 0.05, p.z, 1, on ? col : 0x3a3f4b);
      put(orb, i, p.x, (large ? 1.0 : 0.35) + Math.sin(t * 2 + idx) * 0.06, p.z, on ? 1 : 0, col);
      put(halo, i, p.x, 0.1, p.z, 1, on ? new THREE.Color(col).multiplyScalar(0.8 + Math.sin(t * 3 + idx) * 0.2) : 0x080808);
      if (ring) put(ring, i, p.x, 1.0, p.z, on ? 1 : 0, col, t + idx);
    });
    each(P.small, P.sBase, P.sOrb, P.sHalo, null, false);
    each(P.large, P.lBase, P.lOrb, P.lHalo, P.lRing, true);
    for (const k of ['sBase', 'lBase', 'sOrb', 'lOrb', 'sHalo', 'lHalo', 'lRing']) { P[k].instanceMatrix.needsUpdate = true; if (P[k].instanceColor) P[k].instanceColor.needsUpdate = true; }
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
      obj.traverse((o) => { if (o.isMesh) o.castShadow = this.settings.quality === 'high'; });
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
      // wheels spin with forward speed, front wheels steer
      const fwdSpeed = c.fwdSpeed || 0;
      rc.spin += fwdSpeed * dt / 0.17;
      for (const w of rc.obj.userData.wheels) {
        w.userData.spin.rotation.x = rc.spin;
        if (w.userData.front) w.rotation.y = -(c.steer || 0) * 0.45;
      }
      const flame = rc.obj.userData.flame;
      flame.visible = !!c.boosting;
      if (c.boosting) {
        flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
        rc.obj.userData.flameMat.color.set(rc.trail === 'ember' ? 0xffa040 : rc.trail === 'vapour' ? 0xe5e7eb : rc.trail === 'prism' ? 0xf0abfc : rc.trail === 'aurora' ? 0x6ee7b7 : 0x93c5fd);
        _v.set(0, -0.04, -0.72).applyQuaternion(c.quat).add(c.pos);
        const back = _p.set(0, 0, 1).applyQuaternion(c.quat);
        this.fx.trail(rc.trail, _v.x, _v.y, _v.z, back.x, back.y, back.z, c.vel?.x || 0, c.vel?.y || 0, c.vel?.z || 0, dt, this.time);
      }
      if (rc.obj.userData.halo) rc.obj.userData.halo.rotation.z += dt;
      if (rc.plate) rc.plate.visible = !!s.nameplates && !c.hidden;
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
    // pads
    if (view.pads) this.updatePads(view.pads, this.time);
    this.fx.update(dt);
    this.rings.update(dt);
    if (this.flash.intensity > 0) this.flash.intensity = Math.max(0, this.flash.intensity - dt * 900);
    this.renderer.render(this.scene, this.camera);
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
  dust(pos) {
    this.fx.burst(pos.x, 0.15, pos.z, 10, 2.5, 0.6, 0.35, [0x9ca3af], { flat: true, alpha: 0.4, endSize: 0.6 });
  }
}

export { ARENA_THEMES };
