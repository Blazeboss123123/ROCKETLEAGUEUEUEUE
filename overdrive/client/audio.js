// Procedural audio (Web Audio API): every sound is synthesised at runtime — no samples.
// Buses: master -> music / effects (engines, boost, impacts, goals) / ui.

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.engines = new Map();
    this.musicOn = false;
  }

  // must be called from a user gesture
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.connect(c.destination);
    this.comp = c.createDynamicsCompressor(); this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.comp.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.comp);
    this.music = c.createGain(); this.music.connect(this.master);
    this.ui = c.createGain(); this.ui.connect(this.comp);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    if (this.wantMusic) this.startMusic();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.volMaster, t, 0.05);
    this.sfx.gain.setTargetAtTime(s.volEffects, t, 0.05);
    this.ui.gain.setTargetAtTime(s.volEffects * 0.8, t, 0.05);
    this.music.gain.setTargetAtTime(s.volMusic * 0.35, t, 0.2);
  }

  noise(dur) { const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf; n.loop = true; n.loopEnd = 2; return n; }

  // positional helper: pan/attenuate relative to the listener
  spatial(pos) {
    const c = this.ctx;
    const g = c.createGain(), p = c.createStereoPanner();
    g.connect(p); p.connect(this.sfx);
    if (pos && this.listener) {
      const L = this.listener;
      const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      g.gain.value = Math.min(1, 9 / Math.max(9, dist)) ** 1.1;
      const right = dx * L.right.x + dy * L.right.y + dz * L.right.z;
      p.pan.value = Math.max(-0.85, Math.min(0.85, right / Math.max(4, dist)));
    }
    return g;
  }
  setListener(pos, right) { this.listener = { pos: { x: pos.x, y: pos.y, z: pos.z }, right: { x: right.x, y: right.y, z: right.z } }; }

  tone(type, f0, f1, dur, vol, dest, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  burstNoise(freq, q, dur, vol, dest, type = 'bandpass', delay = 0, f1) {
    const c = this.ctx, t = c.currentTime + delay;
    const n = this.noise(), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.frequency.setValueAtTime(freq, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(dest || this.sfx); n.start(t, Math.random()); n.stop(t + dur + 0.05);
  }

  play(name, opts = {}) {
    if (!this.ctx) return;
    const pos = opts.pos;
    switch (name) {
      case 'jump': { const d = this.spatial(pos); this.tone('triangle', 180, 420, 0.14, 0.25, d); this.burstNoise(1800, 1, 0.1, 0.12, d); break; }
      case 'dodge': { const d = this.spatial(pos); this.burstNoise(900, 0.8, 0.28, 0.35, d, 'bandpass', 0, 3500); break; }
      case 'land': { const d = this.spatial(pos); this.tone('sine', 90, 45, 0.18, Math.min(0.5, 0.15 + (opts.strength || 0) * 0.04), d); this.burstNoise(400, 1, 0.12, 0.15, d, 'lowpass'); break; }
      case 'ball': {
        const d = this.spatial(pos); const s = Math.min(1, (opts.strength || 4) / 20);
        this.tone('sine', 140 + s * 60, 60, 0.22, 0.35 + s * 0.5, d); this.burstNoise(2500, 0.7, 0.06, 0.25 + s * 0.4, d, 'highpass');
        this.tone('square', 900 + s * 400, 300, 0.05, 0.05 + s * 0.08, d); break;
      }
      case 'ballWall': { const d = this.spatial(pos); const s = Math.min(1, (opts.strength || 4) / 25); this.tone('sine', 110, 55, 0.25, 0.2 + s * 0.35, d); this.burstNoise(600, 1.2, 0.15, 0.1 + s * 0.2, d); break; }
      case 'carWall': case 'bump': { const d = this.spatial(pos); const s = Math.min(1, (opts.strength || 4) / 15); this.burstNoise(300, 0.8, 0.2, 0.15 + s * 0.35, d, 'lowpass'); this.tone('sawtooth', 70, 40, 0.15, 0.08 + s * 0.12, d); break; }
      case 'pickup': { const d = this.spatial(pos); if (opts.large) { this.tone('triangle', 520, 1040, 0.25, 0.25, d); this.tone('sine', 780, 1560, 0.3, 0.15, d, 0.05); } else this.tone('triangle', 900, 1300, 0.08, 0.16, d); break; }
      case 'boostEmpty': this.tone('square', 220, 180, 0.06, 0.06, this.sfx); break;
      case 'countdown': this.tone('square', 660, 660, 0.12, 0.18, this.ui); break;
      case 'go': this.tone('square', 1320, 1320, 0.35, 0.2, this.ui); this.tone('sine', 660, 660, 0.35, 0.15, this.ui); break;
      case 'goal': this.goalSound(opts.horn || 'chime', opts.mine); break;
      case 'save': this.tone('triangle', 500, 700, 0.15, 0.15, this.ui); break;
      case 'end': { [523, 659, 784, 1047].forEach((f, i) => this.tone('triangle', f, f, 0.5, 0.2, this.ui, i * 0.14)); this.burstNoise(1200, 0.5, 2.2, 0.25, this.sfx, 'bandpass', 0, 600); break; }
      case 'click': this.tone('sine', 1200, 900, 0.05, 0.1, this.ui); break;
      case 'hover': this.tone('sine', 1600, 1500, 0.025, 0.03, this.ui); break;
      case 'chat': this.tone('sine', 880, 1100, 0.08, 0.1, this.ui); break;
      default: break;
    }
  }

  goalSound(horn, mine) {
    // crowd roar + team horn
    this.burstNoise(900, 0.4, 3.0, 0.5, this.sfx, 'bandpass', 0, 500);
    this.burstNoise(2400, 0.6, 2.4, 0.18, this.sfx, 'bandpass', 0.1, 1200);
    const u = this.ui;
    if (horn === 'horn') { this.tone('sawtooth', 233, 233, 1.0, 0.18, u); this.tone('sawtooth', 294, 294, 1.0, 0.14, u); }
    else if (horn === 'arp') [392, 494, 587, 784, 988].forEach((f, i) => this.tone('square', f, f, 0.18, 0.1, u, i * 0.08));
    else if (horn === 'bass') { this.tone('sine', 220, 40, 1.2, 0.5, u); this.burstNoise(200, 0.5, 0.6, 0.3, u, 'lowpass', 0.05); }
    else [784, 988, 1175].forEach((f, i) => this.tone('triangle', f, f, 0.6, 0.15, u, i * 0.1));
  }

  // continuous engine/boost voices per car
  engine(id, profile, pos, speed, throttle, boosting, isLocal) {
    if (!this.ctx) return;
    let e = this.engines.get(id);
    if (!e || e.profile !== profile) {
      if (e) this.stopEngine(id);
      e = this.makeEngine(profile, isLocal);
      this.engines.set(id, e);
    }
    e.seen = true;
    const c = this.ctx, t = c.currentTime;
    const sp = Math.min(1, speed / 23);
    const P = ENGINE_PROFILES[profile] || ENGINE_PROFILES.v8;
    const f = P.f0 + (P.f1 - P.f0) * (0.15 + sp * 0.85) + Math.abs(throttle) * P.rev;
    e.osc.frequency.setTargetAtTime(f, t, 0.05);
    e.osc2.frequency.setTargetAtTime(f * P.ratio, t, 0.05);
    e.filter.frequency.setTargetAtTime(P.cut + sp * P.cutRange + Math.abs(throttle) * 300, t, 0.08);
    let vol = (0.05 + sp * 0.12 + Math.abs(throttle) * 0.05) * (isLocal ? 1 : 0.6);
    let pan = 0;
    if (!isLocal && this.listener && pos) {
      const L = this.listener;
      const dx = pos.x - L.pos.x, dy = pos.y - L.pos.y, dz = pos.z - L.pos.z, dist = Math.hypot(dx, dy, dz);
      vol *= Math.min(1, 6 / Math.max(6, dist)) ** 1.3;
      pan = Math.max(-0.8, Math.min(0.8, (dx * L.right.x + dy * L.right.y + dz * L.right.z) / Math.max(4, dist)));
    }
    e.gain.gain.setTargetAtTime(vol, t, 0.06);
    e.pan.pan.setTargetAtTime(pan, t, 0.06);
    e.boostGain.gain.setTargetAtTime(boosting ? (isLocal ? 0.22 : 0.1) * (vol / Math.max(0.05, vol) ) : 0.0001, t, 0.04);
  }
  makeEngine(profile, isLocal) {
    const c = this.ctx, P = ENGINE_PROFILES[profile] || ENGINE_PROFILES.v8;
    const osc = c.createOscillator(), osc2 = c.createOscillator(), filter = c.createBiquadFilter(), gain = c.createGain(), pan = c.createStereoPanner();
    osc.type = P.type; osc2.type = P.type2; filter.type = 'lowpass'; filter.Q.value = P.q;
    const g2 = c.createGain(); g2.gain.value = P.mix;
    osc.connect(filter); osc2.connect(g2); g2.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(this.sfx);
    gain.gain.value = 0;
    osc.start(); osc2.start();
    const boost = this.noise(), bf = c.createBiquadFilter(), boostGain = c.createGain();
    bf.type = 'bandpass'; bf.frequency.value = profile === 'electric' ? 2600 : 1400; bf.Q.value = 0.6;
    boostGain.gain.value = 0.0001;
    boost.connect(bf); bf.connect(boostGain); boostGain.connect(pan); boost.start();
    return { profile, osc, osc2, filter, gain, pan, boost, boostGain, seen: true };
  }
  stopEngine(id) {
    const e = this.engines.get(id); if (!e) return;
    try { e.osc.stop(); e.osc2.stop(); e.boost.stop(); } catch { /* ignore */ }
    e.gain.disconnect(); e.pan.disconnect();
    this.engines.delete(id);
  }
  // stop engines not updated this frame
  sweepEngines() { for (const [id, e] of this.engines) { if (!e.seen) this.stopEngine(id); else e.seen = false; } }
  stopAllEngines() { for (const id of [...this.engines.keys()]) this.stopEngine(id); }

  // ambient menu music: slow chord pad with a soft pulse
  startMusic() {
    this.wantMusic = true;
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    const c = this.ctx;
    const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 246.9, 329.6]];
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900; filt.connect(this.music);
    this.musicNodes = [];
    let step = 0;
    const playChord = () => {
      if (!this.musicOn) return;
      const t = c.currentTime;
      const ch = chords[step % chords.length]; step++;
      for (const f of ch) for (const det of [-6, 6]) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'sawtooth'; o.frequency.value = f / 2; o.detune.value = det;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 1.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 4.2);
        o.connect(g); g.connect(filt); o.start(t); o.stop(t + 4.3);
      }
      for (let i = 0; i < 8; i++) this.tone('sine', ch[i % 3] * 2, ch[i % 3] * 2, 0.25, 0.04, this.music, i * 0.5);
      this.musicTimer = setTimeout(playChord, 4000);
    };
    playChord();
  }
  stopMusic() { this.wantMusic = false; this.musicOn = false; clearTimeout(this.musicTimer); }
}

const ENGINE_PROFILES = {
  v8: { type: 'sawtooth', type2: 'square', ratio: 0.5, mix: 0.5, f0: 38, f1: 120, rev: 14, cut: 380, cutRange: 900, q: 2 },
  turbine: { type: 'triangle', type2: 'sine', ratio: 2.01, mix: 0.6, f0: 220, f1: 900, rev: 60, cut: 1200, cutRange: 2400, q: 6 },
  electric: { type: 'sine', type2: 'triangle', ratio: 1.5, mix: 0.4, f0: 160, f1: 720, rev: 40, cut: 1600, cutRange: 1600, q: 1 },
  rotary: { type: 'square', type2: 'sawtooth', ratio: 2, mix: 0.3, f0: 70, f1: 260, rev: 25, cut: 700, cutRange: 1800, q: 3 },
};
