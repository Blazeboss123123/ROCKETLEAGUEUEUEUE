// Third-person chase camera with ball cam, look-back, collision against the arena SDF,
// smooth mode transitions, optional impact shake, and a cinematic replay mode.
import * as THREE from 'three';

const _v = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _t = new THREE.Vector3();

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
    const k = 1 - Math.exp(-dt * s.transitionSpeed * 4);
    this.ballCamT += ((ballCam && ball ? 1 : 0) - this.ballCamT) * k;
    this.backT += ((lookBack ? 1 : 0) - this.backT) * (1 - Math.exp(-dt * 14));

    // camera up: car up on surfaces (wall driving), world up in the air
    const carUp = _u.set(0, 1, 0).applyQuaternion(carQuat);
    const wantUp = onGround ? carUp : _t.set(0, 1, 0);
    this.up.lerp(wantUp, 1 - Math.exp(-dt * 5)).normalize();

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
    let want = carFwd.clone();
    if (ball && this.ballCamT > 0.001) {
      const toBall = _v.copy(ball).sub(carPos);
      toBall.addScaledVector(this.up, -toBall.dot(this.up));
      if (toBall.lengthSq() > 0.5) { toBall.normalize(); want.lerp(toBall, this.ballCamT).normalize(); }
    }
    if (this.backT > 0.001) want.lerp(want.clone().negate(), this.backT);
    // swivel smoothing
    const sw = 1 - Math.exp(-dt * s.swivelSpeed * 2.2);
    this.fwd.lerp(want, sw);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up));
    if (this.fwd.lengthSq() < 1e-4) this.fwd.copy(want);
    this.fwd.normalize();

    // target position behind and above the car
    const target = _t.copy(carPos).addScaledVector(this.fwd, -s.distance).addScaledVector(this.up, s.height);
    const stiff = 1 - Math.exp(-dt * (6 + s.stiffness * 30));
    this.pos.lerp(target, stiff);
    // never trail too far behind at speed
    const maxD = s.distance * 1.6 + 1;
    _v.copy(this.pos).sub(carPos);
    if (_v.length() > maxD) this.pos.copy(carPos).addScaledVector(_v.normalize(), maxD);
    this.collide(carPos);

    // look target: slightly ahead of the car, towards the ball in ball cam
    const look = _v.copy(carPos).addScaledVector(this.up, 0.35 + s.height * 0.25).addScaledVector(this.fwd, 1.2);
    if (ball && this.ballCamT > 0.001) {
      const mid = new THREE.Vector3().copy(ball).sub(carPos);
      const dist = mid.length();
      mid.multiplyScalar(Math.min(0.5, 6 / Math.max(dist, 1)) + 0.12).add(carPos);
      mid.y = Math.min(mid.y, carPos.y + 6);
      look.lerp(mid, this.ballCamT);
    }
    this.look.lerp(look, 1 - Math.exp(-dt * 18));
    this.apply(dt, s);
  }

  collide(carPos) {
    // keep the camera inside the playable volume, sliding towards the car if needed
    const a = this.arena;
    for (let i = 0; i < 10; i++) {
      const d = a.interior(this.pos.x, this.pos.y, this.pos.z);
      if (d > 0.35) break;
      this.pos.lerp(carPos, 0.2);
    }
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
    const vfov = 2 * Math.atan(Math.tan((s.fov * Math.PI / 180) / 2) / aspect) * 180 / Math.PI;
    if (Math.abs(this.cam.fov - vfov) > 0.01) { this.cam.fov = vfov; this.cam.updateProjectionMatrix(); }
  }

  // cinematic camera for replays/celebrations: follows a point from a broadcast angle
  cinematic(dt, focus, settings, side = 1) {
    const want = _t.set(focus.x * 0.6 + side * 14, Math.max(4, focus.y + 4), focus.z - Math.sign(focus.z || 1) * 14);
    this.pos.lerp(want, 1 - Math.exp(-dt * 3));
    this.collide(focus);
    this.look.lerp(focus, 1 - Math.exp(-dt * 8));
    this.up.lerp(_u.set(0, 1, 0), 0.2).normalize();
    this.apply(dt, settings);
  }

  orbit(dt, center, radius, height, settings) {
    this.orbitA += dt * 0.12;
    const want = _t.set(center.x + Math.cos(this.orbitA) * radius, height, center.z + Math.sin(this.orbitA) * radius);
    this.pos.lerp(want, 1 - Math.exp(-dt * 2));
    this.collide(center);
    this.look.lerp(center, 1 - Math.exp(-dt * 4));
    this.up.set(0, 1, 0);
    this.apply(dt, settings);
  }
}
