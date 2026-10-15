// Third-person chase camera with ball cam, look-back, collision against the arena SDF,
// smooth mode transitions, optional impact shake, and a cinematic replay mode.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3(), _w = new THREE.Vector3(), _m = new THREE.Vector3();

export class CameraRig {
  constructor(camera, arena) {
    this.cam = camera;
    this.arena = arena;
    this.pos = new THREE.Vector3(0, 6, -20);
    this.look = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, 1);   // smoothed camera heading
    this.up = new THREE.Vector3(0, 1, 0);    // smoothed camera up
    this.ballCamT = 0;                        // 0 = car cam, 1 = ball cam (blended)
    this.backT = 0;
    this.shake = 0;
    this.mode = 'car';
    this.orbitA = 0;
  }

  addShake(s, settings) { if (settings.cameraShake) this.shake = Math.min(1, this.shake + s); }

  // carPos/carQuat: render state of the followed car; ball: ball position or null
  update(dt, carPos, carQuat, carVel, onGround, ball, settings, ballCam, lookBack) {
    const s = settings;
    this.speed = carVel ? carVel.length() : 0;
    const k = 1 - Math.exp(-dt * s.transitionSpeed * 4);
    this.ballCamT += ((ballCam && ball ? 1 : 0) - this.ballCamT) * k;
    this.backT += ((lookBack ? 1 : 0) - this.backT) * (1 - Math.exp(-dt * 14));

    // camera up: the car's up on surfaces (walls/ceiling), world up in the air. Rolling onto a wall
    // is eased over ~0.25 s; leaving a wall eases back more gently so jumps off walls stay readable.
    const carUp = _u.set(0, 1, 0).applyQuaternion(carQuat);
    const wantUp = onGround ? carUp : _t.set(0, 1, 0);
    this.up.lerp(wantUp, 1 - Math.exp(-dt * (onGround ? 7 : 3.5))).normalize();

    // heading for car cam: car forward flattened against camera up
    const carFwd = _f.set(0, 0, 1).applyQuaternion(carQuat);
    if (!onGround && carVel && carVel.lengthSq() > 4) {
      // in the air, bias towards the car's direction of travel for stability during flips
      _v.copy(carVel).normalize();
      carFwd.lerp(_v, 0.35);
    }
    carFwd.addScaledVector(this.up, -carFwd.dot(this.up));
    if (carFwd.lengthSq() < 1e-4) carFwd.copy(this.fwd);
    carFwd.normalize();
    const want = _w.copy(carFwd);
    if (ball && this.ballCamT > 0.001) {
      const toBall = _v.copy(ball).sub(carPos);
      toBall.addScaledVector(this.up, -toBall.dot(this.up));
      if (toBall.lengthSq() > 0.5) { toBall.normalize(); want.lerp(toBall, this.ballCamT).normalize(); }
    }
    if (this.backT > 0.001) want.lerp(_v.copy(want).negate(), this.backT);
    // swivel smoothing (keep fwd perpendicular to up, so the roll onto a wall never pitches the view)
    const sw = 1 - Math.exp(-dt * s.swivelSpeed * 2.2);
    this.fwd.lerp(want, sw);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-4) this.fwd.copy(want);
    this.fwd.normalize();

    // offset from the car, smoothed in car-relative terms: rotation is eased, but the camera never
    // lags behind in world space (which made it swing through the floor curve onto walls)
    const off = _t.copy(this.fwd).multiplyScalar(-s.distance).addScaledVector(this.up, s.height);
    if (!this.offset) this.offset = off.clone();
    this.offset.lerp(off, 1 - Math.exp(-dt * (8 + s.stiffness * 30)));
    this.pos.copy(carPos).add(this.offset);
    this.collide(carPos);

    // look target: slightly ahead of the car, towards the ball in ball cam
    const look = _v.copy(carPos).addScaledVector(this.up, 0.35 + s.height * 0.25).addScaledVector(this.fwd, 1.2);
    if (ball && this.ballCamT > 0.001) {
      const mid = _m.copy(ball).sub(carPos);
      const dist = mid.length();
      mid.multiplyScalar(Math.min(0.5, 6 / Math.max(dist, 1)) + 0.12).add(carPos);
      // don't crane above the car's own surface plane much (keeps wall play readable)
      const lift = mid.clone().sub(carPos).dot(this.up);
      if (lift > 6) mid.addScaledVector(this.up, 6 - lift);
      look.lerp(mid, this.ballCamT);
    }
    // squeezed against a surface (e.g. ball cam pointing into a wall): favour the car so it stays in frame
    const dc = this.pos.distanceTo(carPos), room = Math.max(1, s.distance * 0.8);
    if (dc < room) look.lerp(_m.copy(carPos).addScaledVector(this.up, 0.3), (1 - dc / room) * 0.85);
    if (!this.lookInit) { this.look.copy(look); this.lookInit = true; }
    this.look.lerp(look, 1 - Math.exp(-dt * 18));
    this.apply(dt, s);
  }

  // Keep the camera inside the arena. Push it out of any surface along the surface normal, so near
  // walls, the floor curve, the ceiling or goal frames it slides along the surface instead of
  // zooming into the car; then make sure the car is still in view through the volume.
  collide(carPos) {
    const a = this.arena, margin = 0.5, e = 0.02;
    const p = this.pos;
    for (let i = 0; i < 6; i++) {
      const d = a.interior(p.x, p.y, p.z);
      if (d >= margin) break;
      const nx = a.interior(p.x + e, p.y, p.z) - a.interior(p.x - e, p.y, p.z);
      const ny = a.interior(p.x, p.y + e, p.z) - a.interior(p.x, p.y - e, p.z);
      const nz = a.interior(p.x, p.y, p.z + e) - a.interior(p.x, p.y, p.z - e);
      const l = Math.hypot(nx, ny, nz) || 1;
      p.x += (nx / l) * (margin - d); p.y += (ny / l) * (margin - d); p.z += (nz / l) * (margin - d);
    }
    // line of sight (only goal boxes/rims can block it, the bowl itself is convex)
    const px = carPos.x + this.up.x * 0.45, py = carPos.y + this.up.y * 0.45, pz = carPos.z + this.up.z * 0.45;
    const dx = p.x - px, dy = p.y - py, dz = p.z - pz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4 || a.interior(px, py, pz) < 0.2) return;
    const ux = dx / len, uy = dy / len, uz = dz / len;
    let t = 0, safe = 0;
    while (t < len) {
      const d = a.interior(px + ux * t, py + uy * t, pz + uz * t);
      if (d < 0.2) break;
      safe = t;
      t += Math.max(0.05, d - 0.2);
    }
    if (t < len) p.set(px + ux * safe, py + uy * safe, pz + uz * safe);
  }

  apply(dt, s) {
    this.cam.position.copy(this.pos);
    if (this.shake > 0.001) {
      const a = this.shake * 0.12;
      this.cam.position.x += (Math.random() - 0.5) * a; this.cam.position.y += (Math.random() - 0.5) * a; this.cam.position.z += (Math.random() - 0.5) * a;
      this.shake *= Math.exp(-dt * 8);
    }
    this.cam.up.copy(this.up);
    this.cam.lookAt(this.look);
    // horizontal FOV setting -> vertical FOV for three.js
    const aspect = this.cam.aspect || 16 / 9;
    // a few degrees of extra field of view at high speed sells the acceleration
    const want = Math.min(1, Math.max(0, ((this.speed || 0) - 13) / 10)) * (s.speedFov ?? 6);
    this.fovKick = (this.fovKick || 0) + (want - (this.fovKick || 0)) * Math.min(1, dt * 4);
    const hfov = Math.min(130, s.fov + this.fovKick);
    const vfov = 2 * Math.atan(Math.tan((hfov * Math.PI / 180) / 2) / aspect) * 180 / Math.PI;
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
  }

  // cinematic camera for replays/celebrations: follows a point from a broadcast angle
  cinematic(dt, focus, settings, side = 1) {
    this.speed = 0;
    const want = _t.set(focus.x * 0.6 + side * 14, Math.max(4, focus.y + 4), focus.z - Math.sign(focus.z || 1) * 14);
    this.pos.lerp(want, 1 - Math.exp(-dt * 3));
    this.collide(focus);
    this.look.lerp(focus, 1 - Math.exp(-dt * 8));
    this.up.lerp(_u.set(0, 1, 0), 0.2).normalize();
    this.apply(dt, settings);
  }

  orbit(dt, center, radius, height, settings) {
    this.speed = 0;
    this.orbitA += dt * 0.12;
    const want = _t.set(center.x + Math.cos(this.orbitA) * radius, height, center.z + Math.sin(this.orbitA) * radius);
    this.pos.lerp(want, 1 - Math.exp(-dt * 2));
    this.collide(center);
    this.look.lerp(center, 1 - Math.exp(-dt * 4));
    this.up.set(0, 1, 0);
    this.apply(dt, settings);
  }
}
