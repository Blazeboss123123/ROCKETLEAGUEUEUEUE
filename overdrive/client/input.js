// Input: keyboard, mouse and gamepad with full remapping, conflict detection, deadzones,
// sensitivity and persistence. Produces the simulation's control object each frame.
import { store } from './store.js';

export const ACTIONS = [
  { id: 'accel', label: 'Accelerate / Pitch down (air)' },
  { id: 'reverse', label: 'Reverse / Pitch up (air)' },
  { id: 'left', label: 'Steer left / Yaw left (air)' },
  { id: 'right', label: 'Steer right / Yaw right (air)' },
  { id: 'jump', label: 'Jump / Dodge' },
  { id: 'boost', label: 'Boost' },
  { id: 'slide', label: 'Powerslide / Air roll (hold + steer)' },
  { id: 'rollLeft', label: 'Air roll left' },
  { id: 'rollRight', label: 'Air roll right' },
  { id: 'ballCam', label: 'Ball camera toggle' },
  { id: 'lookBack', label: 'Look backward' },
  { id: 'scoreboard', label: 'Scoreboard (hold)' },
  { id: 'chat', label: 'Quick chat' },
  { id: 'pause', label: 'Pause / Menu' },
];

export const DEFAULT_BINDS = {
  kb: {
    accel: ['KeyW'], reverse: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], boost: ['ShiftLeft'],
    slide: ['ControlLeft'], rollLeft: ['KeyE'], rollRight: ['KeyR'], ballCam: ['KeyQ'], lookBack: ['Mouse2'],
    scoreboard: ['Tab'], chat: ['KeyT'], pause: ['Escape'],
  },
  pad: {
    accel: ['b7'], reverse: ['b6'], jump: ['b0'], boost: ['b1'], slide: ['b2'], ballCam: ['b3'],
    rollLeft: ['b4'], rollRight: ['b5'], lookBack: ['b11'], pause: ['b9'], scoreboard: ['b8'], chat: ['b12'],
    left: [], right: [],
  },
};

export function keyLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Mouse')) return ['Left Mouse', 'Middle Mouse', 'Right Mouse', 'Mouse 4', 'Mouse 5'][+code.slice(5)] || code;
  if (code.startsWith('b')) {
    const names = ['A / Cross', 'B / Circle', 'X / Square', 'Y / Triangle', 'LB / L1', 'RB / R1', 'LT / L2', 'RT / R2', 'View / Share', 'Menu / Options', 'L-Stick click', 'R-Stick click', 'D-pad Up', 'D-pad Down', 'D-pad Left', 'D-pad Right'];
    return names[+code.slice(1)] || `Button ${code.slice(1)}`;
  }
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Left Shift').replace('ShiftRight', 'Right Shift')
    .replace('ControlLeft', 'Left Ctrl').replace('ControlRight', 'Right Ctrl').replace('AltLeft', 'Left Alt').replace('Space', 'Space');
}

export class InputManager {
  constructor(settings) {
    this.settings = settings;
    this.binds = store.get('binds', null) || structuredClone(DEFAULT_BINDS);
    // fill in any actions added since the binds were saved
    for (const dev of ['kb', 'pad']) for (const a of ACTIONS) if (!this.binds[dev][a.id]) this.binds[dev][a.id] = [...(DEFAULT_BINDS[dev][a.id] || [])];
    this.down = new Set();
    this.pressedEdge = new Set();
    this.capture = null; // remapping callback
    this.enabled = true;
    this.lastDevice = 'kb';
    this.padPrev = new Set();
    this.ballCam = settings.ballCamDefault ?? true;
    this.listeners = [];
    const kd = (e) => {
      if (isTyping(e)) return;
      if (this.capture && this.capture.dev === 'kb') { e.preventDefault(); const cb = this.capture.cb; this.capture = null; cb(e.code); return; }
      if (!this.down.has(e.code)) this.pressedEdge.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kb';
      if (this.enabled && (gameKey(e.code, this.binds) || e.code === 'Tab' || e.code === 'Space')) e.preventDefault();
    };
    const ku = (e) => { this.down.delete(e.code); };
    const md = (e) => {
      if (e.target && e.target.closest && e.target.closest('.ui-layer *:not(.ui-layer)') && !this.enabled) return;
      const code = 'Mouse' + e.button;
      if (this.capture && this.capture.dev === 'kb') { e.preventDefault(); const cb = this.capture.cb; this.capture = null; cb(code); return; }
      if (!this.enabled) return;
      if (!this.down.has(code)) this.pressedEdge.add(code);
      this.down.add(code);
    };
    const mu = (e) => this.down.delete('Mouse' + e.button);
    const blur = () => this.down.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('mousedown', md);
    window.addEventListener('mouseup', mu);
    window.addEventListener('blur', blur);
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
  }

  save() { store.set('binds', this.binds); }
  resetDefaults() { this.binds = structuredClone(DEFAULT_BINDS); this.save(); }

  // Returns the action that already uses `code` on that device (excluding `action`), or null.
  conflict(dev, action, code) {
    for (const a of ACTIONS) if (a.id !== action && (this.binds[dev][a.id] || []).includes(code)) return a.id;
    return null;
  }
  // Bind slot index (0 primary, 1 secondary). Conflicting binds are swapped and reported.
  bind(dev, action, slot, code) {
    const other = this.conflict(dev, action, code);
    const prev = this.binds[dev][action][slot] || null;
    if (other) {
      const arr = this.binds[dev][other];
      const i = arr.indexOf(code);
      if (prev) arr[i] = prev; else arr.splice(i, 1);
    }
    this.binds[dev][action][slot] = code;
    this.binds[dev][action] = this.binds[dev][action].filter(Boolean);
    this.save();
    return other;
  }
  clearBind(dev, action, slot) { this.binds[dev][action].splice(slot, 1); this.save(); }
  startCapture(dev, cb) { this.capture = { dev, cb }; }

  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  isDown(action) {
    for (const c of this.binds.kb[action] || []) if (this.down.has(c)) return true;
    const p = this.pad;
    if (p) for (const c of this.binds.pad[action] || []) { const b = p.buttons[+c.slice(1)]; if (b && (b.pressed || b.value > 0.5)) return true; }
    return false;
  }
  analog(action) {
    let v = 0;
    for (const c of this.binds.kb[action] || []) if (this.down.has(c)) v = 1;
    const p = this.pad;
    if (p) for (const c of this.binds.pad[action] || []) { const b = p.buttons[+c.slice(1)]; if (b) v = Math.max(v, b.value || (b.pressed ? 1 : 0)); }
    return v;
  }
  edge(action) {
    for (const c of this.binds.kb[action] || []) if (this.pressedEdge.has(c)) return true;
    const p = this.pad;
    if (p) for (const c of this.binds.pad[action] || []) { const i = +c.slice(1); if (p.buttons[i]?.pressed && !this.padPrev.has(i)) return true; }
    return false;
  }

  // Called once per rendered frame.
  sample() {
    const s = this.settings;
    this.pad = this.pollPad();
    if (this.pad && this.pad.buttons.some((b) => b.pressed)) this.lastDevice = 'pad';
    const out = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false };
    const ui = { ballCamToggle: false, lookBack: false, scoreboard: false, pause: false, chat: false };
    if (this.capture) { this.endFrame(); return { controls: out, ui }; }
    const thr = this.analog('accel') - this.analog('reverse');
    let steer = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    let pitchStick = 0;
    if (this.pad) {
      const dz = s.deadzone;
      let x = this.pad.axes[0] || 0, y = this.pad.axes[1] || 0;
      const mag = Math.hypot(x, y);
      if (mag < dz) { x = 0; y = 0; } else { const k = (mag - dz) / (1 - dz) / mag; x *= k; y *= k; }
      if (Math.abs(x) > Math.abs(steer)) steer = clamp1(x * s.steerSensitivity);
      pitchStick = clamp1(-y * s.aerialSensitivity) * (s.invertPitch ? -1 : 1);
    }
    out.throttle = clamp1(thr);
    out.steer = clamp1(steer);
    out.yaw = out.steer;
    // keyboard W/S drive pitch in the air; a stick overrides when used
    const kbPitch = (this.isDown('accel') ? 1 : 0) - (this.isDown('reverse') ? 1 : 0);
    out.pitch = Math.abs(pitchStick) > 0.01 ? pitchStick : kbPitch * (s.invertPitch ? -1 : 1);
    out.roll = (this.isDown('rollRight') ? 1 : 0) - (this.isDown('rollLeft') ? 1 : 0);
    out.jump = this.isDown('jump');
    out.boost = this.isDown('boost');
    out.slide = this.isDown('slide');
    ui.ballCamToggle = this.edge('ballCam');
    ui.lookBack = this.isDown('lookBack');
    ui.scoreboard = this.isDown('scoreboard');
    ui.pause = this.edge('pause');
    // on-screen tablet controls (stick up = accelerate / pitch down, like W)
    if (this.touch?.visible) {
      const t = this.touch.read();
      this.lastDevice = 'touch';
      if (Math.abs(t.x) > Math.abs(out.steer)) { out.steer = clamp1(t.x * s.steerSensitivity); out.yaw = out.steer; }
      if (Math.abs(t.y) > Math.abs(out.throttle)) out.throttle = clamp1(-t.y);
      if (Math.abs(t.y) > Math.abs(out.pitch)) out.pitch = clamp1(-t.y * s.aerialSensitivity) * (s.invertPitch ? -1 : 1);
      out.jump = out.jump || t.jump; out.boost = out.boost || t.boost; out.slide = out.slide || t.slide;
      ui.ballCamToggle = ui.ballCamToggle || t.ballCam;
      ui.scoreboard = ui.scoreboard || t.scoreboard;
      ui.pause = ui.pause || t.pause;
    }
    ui.chat = this.edge('chat');
    if (ui.ballCamToggle) this.ballCam = !this.ballCam;
    ui.ballCam = this.ballCam;
    this.endFrame();
    if (!this.enabled) return { controls: { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false }, ui };
    return { controls: out, ui };
  }

  endFrame() {
    this.pressedEdge.clear();
    this.padPrev.clear();
    if (this.pad) this.pad.buttons.forEach((b, i) => { if (b.pressed) this.padPrev.add(i); });
  }

  // poll for a pad button during remapping
  pollCapture() {
    if (!this.capture || this.capture.dev !== 'pad') return;
    const p = this.pollPad();
    if (!p) return;
    p.buttons.forEach((b, i) => {
      if (b.pressed && !this.padPrev.has(i) && this.capture) { const cb = this.capture.cb; this.capture = null; cb('b' + i); }
    });
    this.padPrev.clear(); p.buttons.forEach((b, i) => { if (b.pressed) this.padPrev.add(i); });
  }
}

function clamp1(v) { return v < -1 ? -1 : v > 1 ? 1 : v; }
function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
function gameKey(code, binds) { for (const k in binds.kb) if (binds.kb[k].includes(code)) return true; return false; }
