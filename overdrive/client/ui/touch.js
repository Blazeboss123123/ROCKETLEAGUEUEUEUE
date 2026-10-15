// Tablet / touch-screen controls: a floating joystick on the left half of the screen and a
// button cluster on the right. Multi-touch: every finger is tracked by its pointer id.
//
//   Joystick  up/down = accelerate/reverse (pitch in the air), left/right = steer (yaw in the air)
//   JUMP      jump; tap again with the stick tilted to dodge/flip
//   BOOST     hold
//   DRIFT     hold: powerslide on the ground, air roll (with the stick) in the air
//   CAM       ball cam on/off       ☰ pause       ▤ scoreboard (toggle)
import { h } from './dom.js';

export function touchPreferred() {
  try { return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches); } catch { return false; }
}

export class TouchControls {
  constructor(settings) {
    this.settings = settings;
    this.stick = { x: 0, y: 0, id: null, ox: 0, oy: 0 };
    this.held = new Set();          // jump, boost, slide
    this.edges = new Set();         // ballCam, pause
    this.board = false;             // scoreboard toggle
    this.visible = false;
    const R = 60; // stick travel in CSS px (scaled with the setting)
    this.R = R;

    this.base = h('div', { class: 'tc-base' }, this.knob = h('div', { class: 'tc-knob' }));
    this.zone = h('div', { class: 'tc-zone', 'aria-label': 'Steering joystick' }, this.base);
    const btn = (id, label, cls, kind) => {
      const b = h('div', { class: 'tc-btn ' + cls, role: 'button', 'aria-label': label }, label);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        try { b.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        b.classList.add('on');
        if (kind === 'hold') this.held.add(id);
        else if (kind === 'toggle') { this.board = !this.board; b.classList.toggle('lit', this.board); }
        else this.edges.add(id);
        if (navigator.vibrate && this.settings.touchHaptics !== false) { try { navigator.vibrate(8); } catch { /* ignore */ } }
      });
      const up = (e) => { e.preventDefault(); b.classList.remove('on'); if (kind === 'hold') this.held.delete(id); };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', () => { b.classList.remove('on'); if (kind === 'hold') this.held.delete(id); });
      return b;
    };
    this.jumpBtn = btn('jump', 'JUMP', 'jump', 'hold');
    this.boostBtn = btn('boost', 'BOOST', 'boost', 'hold');
    this.slideBtn = btn('slide', 'DRIFT', 'slide', 'hold');
    this.camBtn = btn('ballCam', 'CAM', 'cam', 'edge');
    this.pauseBtn = btn('pause', '☰', 'pause small', 'edge');
    this.boardBtn = btn('scoreboard', '▤', 'board small', 'toggle');
    this.root = h('div', { class: 'touch-ctl hidden' }, this.zone, this.jumpBtn, this.boostBtn, this.slideBtn, this.camBtn, this.pauseBtn, this.boardBtn);

    // joystick: appears where the thumb lands anywhere in the left zone
    this.zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.stick.id !== null) return;
      try { this.zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const r = this.zone.getBoundingClientRect();
      this.stick.id = e.pointerId;
      this.stick.ox = e.clientX - r.left; this.stick.oy = e.clientY - r.top;
      this.base.style.left = this.stick.ox + 'px'; this.base.style.top = this.stick.oy + 'px';
      this.base.classList.add('active');
      this.move(e);
    });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stick.id) { e.preventDefault(); this.move(e); } });
    const end = (e) => { if (e.pointerId === this.stick.id) this.releaseStick(); };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.applyLayout();
  }

  move(e) {
    const r = this.zone.getBoundingClientRect();
    const R = this.R * (this.settings.touchScale || 1);
    let dx = e.clientX - r.left - this.stick.ox, dy = e.clientY - r.top - this.stick.oy;
    const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // small deadzone, then full range; a slight curve gives finer steering near the centre
    const curve = (v) => { const a = Math.abs(v); const d = 0.12; if (a < d) return 0; const k = (a - d) / (1 - d); return Math.sign(v) * (0.35 * k + 0.65 * k * k); };
    this.stick.x = curve(dx / R);
    this.stick.y = curve(dy / R);
  }

  releaseStick() {
    this.stick.id = null; this.stick.x = 0; this.stick.y = 0;
    this.knob.style.transform = '';
    this.base.classList.remove('active');
    this.base.style.left = ''; this.base.style.top = '';
  }

  applyLayout() {
    const s = this.settings;
    this.root.style.setProperty('--tc-scale', s.touchScale || 1);
    this.root.style.setProperty('--tc-alpha', s.touchOpacity ?? 0.6);
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.root.classList.toggle('hidden', !v);
    document.body.classList.toggle('touch-mode', v);
    if (!v) { this.releaseStick(); this.held.clear(); this.edges.clear(); this.board = false; this.boardBtn.classList.remove('lit'); }
  }

  // merged into InputManager.sample()
  read() {
    const out = { x: this.stick.x, y: this.stick.y, jump: this.held.has('jump'), boost: this.held.has('boost'), slide: this.held.has('slide'),
      ballCam: this.edges.has('ballCam'), pause: this.edges.has('pause'), scoreboard: this.board };
    this.edges.clear();
    return out;
  }
}
