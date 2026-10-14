// Project Overdrive — client application: screen flow, sessions (online/offline/training),
// main loop, presentation of simulation events, replays, progression.
import * as THREE from 'three';
import { TEAM_COLORS, TEAM_COLORS_ALT, MODES, ARENA_VARIANTS, PHYSICS, BALL } from '../shared/config.js';
import { ClientSession, localPair } from '../shared/client.js';
import { MatchHost } from '../shared/host.js';
import { wsConnect } from '../shared/wsconn.js';
import { V3, Quat } from '../shared/math.js';
import { log, setQuiet } from '../shared/log.js';
import { QUICK_CHAT } from '../shared/protocol.js';
import { GameRenderer } from './render/scene.js';
import { InputManager } from './input.js';
import { AudioEngine } from './audio.js';
import { Profile, loadSettings, saveSettings } from './profile.js';
import { store } from './store.js';
import { TrainingSession, DRILLS } from './training.js';
import { getRoom, RoomHost, RoomClientConn, findPublicMatch, shouldYield } from './net/room.js';
import { h, clear, toast } from './ui/dom.js';
import { HUD } from './ui/hud.js';
import * as screens from './ui/screens.js';
import { settingsScreen } from './ui/settings.js';
import { garageScreen } from './ui/garage.js';

setQuiet(true);
const DEFAULT_PREFS = { casualMode: '3v3', practiceMode: '3v3', practiceBots: 'pro', practiceArena: 'stadium', practiceLength: 300, privateMode: '3v3', privateFill: 'off', privateArena: 'stadium', serverUrl: '' };
const _p = new V3(), _q = new Quat();

class Replay {
  constructor() { this.frames = []; this.playing = null; }
  record(t, view) {
    this.frames.push({ t, cars: view.cars.map((c) => ({ id: c.id, team: c.team, p: c.pos.clone(), q: c.quat.clone(), boosting: c.boosting, fwdSpeed: c.fwdSpeed, steer: c.steer, vel: c.vel.clone(), hidden: c.hidden })), ball: { pos: view.ball.pos.clone(), hidden: view.ball.hidden, angVel: view.ball.angVel ? { ...view.ball.angVel } : null } });
    while (this.frames.length && t - this.frames[0].t > 7) this.frames.shift();
  }
  start(now) {
    // last frame with a visible ball = the moment it crossed the line
    let end = this.frames.length - 1;
    while (end > 0 && this.frames[end].ball.hidden) end--;
    if (end < 10) return false;
    const tEnd = this.frames[end].t + 0.35;
    const tStart = tEnd - 4.2;
    const frames = this.frames.filter((f) => f.t >= tStart && f.t <= tEnd);
    if (frames.length < 10) return false;
    this.playing = { frames, t0: now, dur: frames[frames.length - 1].t - frames[0].t, base: frames[0].t };
    return true;
  }
  frame(now) {
    const P = this.playing; if (!P) return null;
    const el = (now - P.t0) * 0.85;
    if (el >= P.dur) { this.playing = null; return null; }
    const t = P.base + el;
    let i = 0; while (i < P.frames.length - 2 && P.frames[i + 1].t < t) i++;
    const a = P.frames[i], b = P.frames[i + 1];
    const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-4, b.t - a.t)));
    return {
      cars: a.cars.map((c, j) => { const d = b.cars.find((x) => x.id === c.id) || c; return { ...c, pos: c.p.clone().lerp(d.p, k), quat: c.q.clone().slerp(d.q, k), vel: c.vel }; }),
      ball: { pos: a.ball.pos.clone().lerp(b.ball.pos, k), hidden: a.ball.hidden && b.ball.hidden, angVel: a.ball.angVel },
    };
  }
}

class App {
  constructor() {
    this.settings = loadSettings();
    this.profile = new Profile();
    this.prefs = { ...DEFAULT_PREFS, ...store.get('prefs', {}) };
    this.storePersistent = store.persistent;
    this.colors = this.settings.colorblind ? TEAM_COLORS_ALT : TEAM_COLORS;
    this.container = document.getElementById('app');
    this.ui = document.querySelector('.ui-layer');
    this.renderer = new GameRenderer(this.container, this.settings);
    this.renderer.colors = this.colors;
    this.renderer.applyQuality(this.settings.quality);
    this.renderer.setShowroomCar(this.profile.loadout, 0);
    this.input = new InputManager(this.settings);
    this.audio = new AudioEngine(this.settings);
    this.hud = new HUD(this);
    this.replay = new Replay();
    this.net = { server: false, serverOk: false, room: false };
    this.mode = 'menu';
    this.screen = null; this.screenName = '';
    this.session = null; this.training = null; this.localHost = null; this.roomHost = null;
    this.paused = false; this.overlay = null;
    this.fpsEl = h('div', { class: 'fps hidden' });
    this.ui.appendChild(this.fpsEl);
    this.viewCars = []; this.viewBall = { pos: new THREE.Vector3(), hidden: false, angVel: null };
    this.recorded = new Set();
    this.applySettings('uiScale');
    const unlock = () => { this.audio.unlock(); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.roomHost) toast('You are hosting: keep this tab visible or the match will stall.', 'err', 6000); });
    window.addEventListener('beforeunload', () => { try { this.session?.leave(); this.roomHost?.close(); } catch { /* ignore */ } });
    this.detectNetwork();
    this.go('main');
    this.last = performance.now();
    this.lastDraw = 0; this.frames = 0; this.fpsT = 0;
    requestAnimationFrame((t) => this.frame(t));
    window.__od = this; // debugging / automated tests
  }

  savePrefs() { store.set('prefs', this.prefs); }
  uiClick() { this.audio.play('click'); }

  // ------------------------------------------------------------------ network detection
  serverWsBase() {
    if (this.prefs.serverUrl) return this.prefs.serverUrl.replace(/\/?$/, '').replace(/\/ws$/, '') + '/ws';
    if (location.protocol === 'http:' || location.protocol === 'https:') return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
    return null;
  }
  async detectNetwork() {
    const base = this.serverWsBase();
    if (base) {
      const statusUrl = base.replace(/^ws/, 'http').replace(/\/ws$/, '/status');
      try {
        const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(statusUrl, { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(tm);
        const j = r.ok ? await r.json() : null;
        this.net.server = !!(j && j.ok); this.net.serverOk = this.net.server;
      } catch { this.net.server = false; this.net.serverOk = false; }
    }
    const room = await getRoom();
    this.room = room;
    this.net.room = !!room;
    if (this.screenName === 'main' || this.screenName === 'play') this.go(this.screenName);
  }

  // ------------------------------------------------------------------ screens
  go(name, params = {}) {
    this.screen?.leave?.();
    if (this.overlay && !['settings'].includes(name)) { /* keep overlays only for in-match settings */ }
    const make = {
      main: screens.mainMenu, play: screens.playMenu, practice: screens.practiceMenu, private: screens.privateMenu, training: screens.trainingMenu,
      searching: screens.searching, lobby: screens.lobbyScreen, profile: screens.profileScreen, stats: screens.statsScreen, credits: screens.creditsScreen,
      exit: screens.exitScreen, settings: settingsScreen, garage: garageScreen,
    }[name];
    if (!make) return;
    if (this.screen?.el) this.screen.el.remove();
    this.screenName = name;
    this.screen = make(this, params);
    this.ui.insertBefore(this.screen.el, this.ui.firstChild);
    if (['main', 'garage', 'play', 'practice', 'private', 'training', 'profile', 'stats', 'credits', 'settings'].includes(name) && this.mode === 'menu') this.audio.startMusic();
    this.renderer.showroom.shift = name === 'main' ? 0.16 : 0;
    if (name !== 'garage') this.renderer.showroom.auto = true;
  }
  hideScreen() { this.screen?.leave?.(); if (this.screen?.el) this.screen.el.remove(); this.screen = null; this.screenName = ''; }

  confirm(title, text, onYes) {
    const ov = h('div', { class: 'overlay', style: { zIndex: 40 } },
      h('div', { class: 'panel modal' }, h('h2', null, title), h('p', { class: 'muted' }, text),
        h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '16px' } },
          h('button', { class: 'btn', onclick: () => ov.remove() }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => { ov.remove(); onYes(); } }, 'Confirm'))));
    this.ui.appendChild(ov);
  }

  resetProfile() { store.remove('profile'); this.profile = new Profile(); this.renderer.setShowroomCar(this.profile.loadout, 0); toast('Profile reset'); this.go('profile'); }

  applySettings(key) {
    const s = this.settings;
    saveSettings(s);
    if (key === 'quality' || key === 'renderScale' || key === '*') this.renderer.applyQuality(s.quality);
    if (key.startsWith?.('vol') || key === '*') this.audio.applyVolumes();
    if (key === 'uiScale' || key === '*') document.documentElement.style.setProperty('--ui-scale', s.uiScale);
    if (key === 'colorblind' || key === '*') {
      this.colors = s.colorblind ? TEAM_COLORS_ALT : TEAM_COLORS;
      this.renderer.colors = this.colors;
      document.documentElement.style.setProperty('--orange', this.colors[1].css);
      this.renderer.showroom.key = '';
      this.renderer.setShowroomCar(this.profile.loadout, 0);
      if (this.renderer.arena) { this.renderer.setArena(this.renderer.arena, this.renderer.themeId, this.colors); }
    }
    if (key === 'displayMode') {
      if (s.displayMode === 'fullscreen' && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => toast('Fullscreen was blocked by the browser', 'err'));
      if (s.displayMode === 'windowed' && document.fullscreenElement) document.exitFullscreen?.();
    }
    if (key === 'showFps' || key === '*') this.fpsEl.classList.toggle('hidden', !s.showFps);
  }

  openSettings() { this.settingsReturn = this.screenName || 'pause'; this.hidePause(); this.go('settings'); }
  closeSettings() {
    if (this.mode !== 'menu' && this.settingsReturn === 'pause') { this.hideScreen(); this.showPause(); }
    else this.go(this.settingsReturn && this.settingsReturn !== 'settings' ? this.settingsReturn : 'main');
  }

  // ------------------------------------------------------------------ sessions
  beginClient(conn, info = {}) {
    this.endSession(true);
    const S = new ClientSession({ conn, name: this.profile.name, cos: this.profile.cosmetics(), token: info.token || null });
    conn.attach?.(S);
    this.session = S;
    this.mode = 'session';
    this.sessionInfo = info;
    this.audio.stopMusic();
    this.go('lobby');
    return S;
  }

  playOnline(mode) {
    if (this.net.server) {
      const conn = wsConnect(`${this.serverWsBase()}?op=queue&mode=${mode}`);
      this.beginClient(conn, { online: true, via: 'server' });
      return;
    }
    if (this.room) {
      this.searchStatus = 'Looking for an open lobby…';
      this.mode = 'searching';
      this.go('searching', { mode });
      const token = (this.searchToken = {});
      findPublicMatch(this.room, mode, (st) => { this.searchStatus = `${st.searching} player(s) searching nearby`; }).then((r) => {
        if (this.searchToken !== token) return;
        if (r.join) this.joinRoom(r.join, { online: true });
        else this.hostRoom({ mode, isPrivate: false, fill: 'pro', arena: 'stadium' });
      });
      return;
    }
    toast('No online service is available here. Try Practice vs Bots.', 'err');
  }
  cancelSearch() { this.searchToken = null; this.room?.presence({ seek: null }).catch(() => {}); this.mode = 'menu'; this.go('play'); }

  createPrivate({ mode, fill, arena }) {
    if (this.net.server) { this.beginClient(wsConnect(`${this.serverWsBase()}?op=create&mode=${mode}&fill=${fill}&arena=${arena}`), { online: true, via: 'server' }); return; }
    if (this.room) { this.hostRoom({ mode, isPrivate: true, fill, arena }); return; }
    toast('Private matches need the dedicated server or the shared link.', 'err');
  }
  joinPrivate(code) {
    if (this.net.server) { this.beginClient(wsConnect(`${this.serverWsBase()}?op=join&code=${code}`), { online: true, via: 'server', code }); return; }
    if (this.room) { this.joinRoom(code, { online: true }); return; }
    toast('Joining needs the dedicated server or the shared link.', 'err');
  }
  async hostRoom({ mode, isPrivate, fill, arena }) {
    try {
      const rh = new RoomHost({ room: this.room, mode, isPrivate, fill, arena });
      await rh.open();
      const S = this.beginClient(rh.local.conn, { online: true, via: 'room-host' });
      rh.local.attach(S);
      this.roomHost = rh; this.hostAcc = 0;
      if (!isPrivate) { rh.advertise(this.room); this.advertT = setInterval(() => { rh.advertise(this.room); const y = shouldYield(this.room, rh); if (y) { log('net', 'merging into another public lobby', y); this.joinRoom(y, { online: true }); } }, 1000); }
    } catch (e) {
      log('net', 'hosting failed', String(e?.code || e));
      toast('Could not open a multiplayer room: ' + (e?.message || e?.code || 'unknown error'), 'err');
      this.mode = 'menu'; this.go('play');
    }
  }
  async joinRoom(code, info) {
    const conn = new RoomClientConn(this.room, code);
    this.beginClient(conn, { ...info, via: 'room-client', code });
    try { await conn.open(); } catch (e) { toast('Could not reach that match.', 'err'); this.leaveSession(); }
  }

  practice({ mode, difficulty, arena, duration }) {
    const host = new MatchHost({ mode, kind: 'offline', isPrivate: true, fill: difficulty, autoStart: true, duration, arena });
    const pair = localPair(host);
    host.out = (target, msg) => pair.deliver(target, msg);
    const S = this.beginClient(pair.conn, { online: false, via: 'offline' });
    pair.attach(S);
    this.localHost = host; this.hostAcc = 0;
  }

  startTraining(drill) {
    this.endSession(true);
    this.training = new TrainingSession(drill, { name: this.profile.name, cos: this.profile.cosmetics() });
    this.mode = 'training';
    this.audio.stopMusic();
    this.hideScreen();
    this.enterMatchView(this.training.world.arena, this.settings.arena || 'stadium');
    this.renderer.syncCars(this.training.roster, 1);
    this.ui.appendChild(this.hud.root);
    this.input.enabled = true;
  }

  enterMatchView(arena, themeId) {
    this.renderer.setArena(arena, themeId, this.colors);
    this.replay = new Replay();
    this.renderer.rig.pos.set(0, 6, -40);
    this.input.ballCam = this.settings.ballCamDefault;
    this.goSince = 99; this.lastCount = 0;
  }

  endSession(silent) {
    clearInterval(this.advertT);
    if (this.session) { try { this.session.leave(); } catch { /* ignore */ } }
    if (this.roomHost) { this.roomHost.close(); this.room?.presence({ mm: null }).catch(() => {}); }
    this.session = null; this.localHost = null; this.roomHost = null; this.training = null;
    this.hud.root.remove(); this.hidePause(); this.closeResults();
    this.audio.stopAllEngines();
    this.renderer.clearCars();
    this.inMatchView = false; this.paused = false; this.quickChat = false;
    this.mode = 'menu';
    if (!silent) this.audio.startMusic();
  }
  leaveSession() { this.endSession(); this.go('main'); }
  backToLobby() { this.closeResults(); if (this.session?.kind === 'offline') { this.leaveSession(); this.go('practice'); return; } this.session?.toLobby(); }

  // ------------------------------------------------------------------ pause / results overlays
  showPause() {
    this.hidePause();
    const offline = this.mode === 'training' || this.session?.kind === 'offline';
    this.paused = offline;
    const T = this.training;
    const items = [h('button', { class: 'btn primary', onclick: () => this.hidePause() }, 'Resume')];
    if (T) {
      items.push(h('button', { class: 'btn', onclick: () => { T.restart(); this.hidePause(); } }, 'Restart drill'));
      if (T.drill === 'free') items.push(h('button', { class: 'btn', onclick: (e) => { T.unlimitedBoost = !T.unlimitedBoost; e.target.textContent = 'Unlimited boost: ' + (T.unlimitedBoost ? 'On' : 'Off'); } }, 'Unlimited boost: ' + (T.unlimitedBoost ? 'On' : 'Off')));
      items.push(h('button', { class: 'btn', onclick: () => { this.endSession(true); this.go('training'); } }, 'Change drill'));
    }
    items.push(h('button', { class: 'btn', onclick: () => this.openSettings() }, 'Settings'));
    items.push(h('button', { class: 'btn danger', onclick: () => this.confirm(T ? 'Leave training?' : 'Leave match?', T ? 'Return to the main menu.' : (this.session?.kind === 'offline' ? 'This practice match will be abandoned.' : 'A bot will take over your car for the rest of the match.'), () => this.leaveSession()) }, T ? 'Leave training' : 'Leave match'));
    this.pauseEl = h('div', { class: 'overlay', style: { zIndex: 30 } }, h('div', { class: 'panel modal', style: { minWidth: '340px' } },
      h('h2', null, offline ? 'Paused' : 'Menu'), !offline ? h('p', { class: 'small muted' }, 'Online matches keep running while this menu is open.') : null,
      h('div', { class: 'col' }, items)));
    this.ui.appendChild(this.pauseEl);
    this.input.enabled = false;
  }
  hidePause() { if (this.pauseEl) { this.pauseEl.remove(); this.pauseEl = null; } this.paused = false; this.input.enabled = true; }
  closeResults() { if (this.resultsEl) { this.resultsEl.el.remove(); this.resultsEl = null; } }

  onMatchEnd(result) {
    const S = this.session;
    let progress = null;
    const key = (S.code || 'x') + ':' + result.mid + ':' + S.pid;
    const me = result.roster.find((r) => r.pid === S.pid);
    if (me && !this.recorded.has(key)) {
      this.recorded.add(key);
      const st = result.stats?.[S.pid] || null;
      let mvp = null, best = -1;
      for (const r of result.roster) if (r.team === result.winner && result.stats?.[r.pid] && result.stats[r.pid].score > best) { best = result.stats[r.pid].score; mvp = r.pid; }
      progress = this.profile.recordMatch({ won: result.winner === me.team, lost: result.winner === 1 - me.team, stats: st, durationSec: S.world ? S.world.duration - Math.max(0, S.world.match.clock) + (S.world.match.overtime ? S.world.match.clock : 0) : 0, mvp: mvp === S.pid, online: S.kind !== 'offline', modeLabel: MODES[S.mode]?.label || S.mode, score: result.score, team: me.team });
      if (progress.levelUps.length) this.renderer.setShowroomCar(this.profile.loadout, 0);
    }
    this.audio.play('end');
    this.closeResults();
    this.resultsEl = screens.resultsOverlay(this, result, progress);
    this.ui.appendChild(this.resultsEl.el);
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    const lim = this.settings.fpsLimit;
    if (lim > 0 && now - this.lastDraw < 1000 / lim - 0.5) return;
    this.lastDraw = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.frames++; this.fpsT += dt;
    if (this.fpsT > 0.5) { this.fpsEl.textContent = `${Math.round(this.frames / this.fpsT)} fps`; this.frames = 0; this.fpsT = 0; }
    try {
      const { controls, ui } = this.input.sample();
      if (this.mode === 'session') this.sessionFrame(dt, controls, ui, now / 1000);
      else if (this.mode === 'training') this.trainingFrame(dt, controls, ui, now / 1000);
      else this.renderer.drawShowroom(dt);
      this.screen?.update?.(dt);
    } catch (e) {
      log('ui', 'frame error', String(e.stack || e));
      console.error(e);
    }
  }

  handleCommonUi(ui) {
    if (ui.pause) { if (this.pauseEl) this.hidePause(); else if (!this.screen) this.showPause(); }
  }

  sessionFrame(dt, controls, ui, now) {
    const S = this.session;
    if (!S) { this.mode = 'menu'; return; }
    if (this.mode !== 'session') return;
    const phase = S.lobby?.phase;
    const inMatch = S.world && phase !== 'lobby';
    if (inMatch && !this.inMatchView) {
      this.hideScreen(); this.closeResults();
      this.enterMatchView(S.world.arena, S.arenaId || 'stadium');
      this.ui.appendChild(this.hud.root);
      this.inMatchView = true;
      this.matchMid = S.mid;
    }
    if (!inMatch && this.inMatchView && phase === 'lobby') {
      this.inMatchView = false; this.hud.root.remove(); this.closeResults(); this.renderer.clearCars(); this.audio.stopAllEngines();
      this.go('lobby');
    }
    if (inMatch && this.matchMid !== S.mid) { this.matchMid = S.mid; this.closeResults(); this.replay = new Replay(); }
    if (inMatch) this.handleCommonUi(ui);

    // quick chat
    if (inMatch && ui.chat && !this.settings.quickChatOff) this.quickChat = !this.quickChat;
    if (this.quickChat) {
      for (let i = 0; i < 9; i++) if (this.input.pressedDigit?.(i)) { /* handled in keydown */ }
    }

    // controls are neutral while menus/replays/quick-chat overlays are up
    const replaying = !!this.replay.playing;
    const neutral = this.pauseEl || this.screen || replaying || !inMatch;
    const ctl = neutral ? { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false } : controls;
    if (replaying && (controls.jump && !this.prevJump)) this.replay.playing = null; // skip replay
    this.prevJump = controls.jump;

    if (!this.paused) {
      S.update(dt, ctl);
      const host = this.localHost || this.roomHost;
      if (host) {
        this.hostAcc += Math.min(dt, 0.25);
        while (this.hostAcc >= PHYSICS.dt) { this.hostAcc -= PHYSICS.dt; host.tick(); }
        if (this.roomHost) this.roomHost.publish();
      }
    }

    // session events
    for (const e of S.drainEvents()) this.onSessionEvent(e, now);
    if (!this.session) return;
    if (!inMatch) { this.renderer.drawShowroom(dt); return; }
    const W = S.world;
    this.renderer.syncCars(S.roster, S.pid);
    // simulation events (predicted locally)
    this.presentWorldEvents(W.events, S.pid);
    W.events.length = 0;
    this.buildView(S, W);
    this.replay.record(now, this.view);
    this.drawWorld(dt, now, S.pid, W, ui);
    const me = W.car(S.pid);
    this.updateCountdown(W);
    this.hud.update(this.hudState(S, W, me, ui));
    this.hud.showBoard(ui.scoreboard && !this.resultsEl, { score: W.match.score, roster: this.rosterWithConn(S), stats: S.stats, me: S.pid, ping: S.pings });
    if (this.resultsEl) this.resultsEl.update?.();
  }

  rosterWithConn(S) { return (S.roster || []).map((r) => ({ ...r, conn: S.conn_?.[r.pid] ?? (r.bot ? 2 : 1) })); }

  trainingFrame(dt, controls, ui, now) {
    const T = this.training;
    this.handleCommonUi(ui);
    const neutral = this.pauseEl || this.screen;
    if (!this.paused) T.update(dt, neutral ? { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false } : controls);
    const evs = T.drainEvents();
    this.presentWorldEvents(evs, 1);
    for (const e of evs) {
      if (e.type === 'drillOk') this.audio.play('save');
      if (e.type === 'goal') { this.renderer.goal(e, e.team, this.profile.loadout.goal); this.audio.play('goal', { horn: this.profile.loadout.horn }); }
    }
    this.buildView(T, T.world);
    this.drawWorld(dt, now, 1, T.world, ui);
    const d = DRILLS[T.drill];
    const me = T.world.car(1);
    this.hud.update({ kind: 'training', score: [0, 0], clock: 0, boost: me.boost, hasCar: true, state: 'free', roster: [],
      drillTitle: d.name + (T.drill !== 'free' ? `  ·  ${Math.min(T.round + 1, d.count)}/${d.count}` : ''),
      drillText: T.done ? T.message + ' — Esc for options' : T.drill === 'free' ? (T.message && T.resetT > 0 ? T.message : `Boost: ${T.unlimitedBoost ? 'unlimited' : 'normal'} · Esc for options`) : (T.resetT > 0 ? T.message : `${T.drill === 'dribble' ? 'Streak ' + T.streak.toFixed(1) + ' s · best ' + T.best.toFixed(1) + ' s' : 'Success ' + T.success}  ·  ${Math.max(0, T.timer).toFixed(1)} s`),
      goSince: 99, showPing: false });
  }

  buildView(src, W) {
    const cars = [];
    for (let i = 0; i < W.cars.length; i++) {
      const c = W.cars[i];
      let v = this.viewCars[i];
      if (!v) { v = this.viewCars[i] = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3() }; }
      src.carRender(c, _p, _q);
      v.id = c.id; v.team = c.team; v.pos.set(_p.x, _p.y, _p.z); v.quat.set(_q.x, _q.y, _q.z, _q.w);
      v.vel.set(c.vel.x, c.vel.y, c.vel.z); v.boosting = c.boosting; v.fwdSpeed = c.vel.dot(c.fwd); v.steer = c.input?.steer || 0; v.onGround = c.onGround; v.boost = c.boost; v.throttle = c.input?.throttle || 0;
      v.hidden = c.demoT > 0; v.supersonic = c.supersonic;
      cars.push(v);
    }
    src.ballRender(_p);
    this.viewBall.pos.set(_p.x, _p.y, _p.z);
    this.viewBall.hidden = W.ballHidden;
    this.viewBall.angVel = W.ball.angVel;
    this.view = { cars, ball: this.viewBall, pads: W.pads };
  }

  drawWorld(dt, now, myPid, W, ui) {
    const R = this.renderer, s = this.settings;
    let view = this.view;
    const rep = this.replay.playing ? this.replay.frame(now) : null;
    if (rep) {
      view = { cars: rep.cars, ball: rep.ball, pads: W.pads };
      R.rig.cinematic(dt, rep.ball.pos, s, rep.ball.pos.x > 0 ? -1 : 1);
    } else {
      const mine = view.cars.find((c) => c.id === myPid);
      const state = W.match.state;
      if (mine && mine.hidden && state !== 'ended') {
        R.rig.cinematic(dt, view.ball.hidden ? mine.pos : view.ball.pos, s, mine.pos.x > 0 ? 1 : -1);
      } else if (mine && state !== 'ended') {
        R.rig.update(dt, mine.pos, mine.quat, mine.vel, mine.onGround, view.ball.hidden ? null : view.ball.pos, s, ui.ballCam, ui.lookBack);
      } else {
        R.rig.orbit(dt, view.ball.hidden ? new THREE.Vector3(0, 1, 0) : view.ball.pos, 26, 12, s);
      }
    }
    // listener for positional audio
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(R.camera.quaternion);
    this.audio.setListener(R.camera.position, right);
    // engine audio: own car + nearest three
    if (!this.paused) {
      const camPos = R.camera.position;
      const sorted = view.cars.map((c) => ({ c, d: c.id === myPid ? -1 : c.pos.distanceTo(camPos) })).sort((a, b) => a.d - b.d).slice(0, 4);
      for (const { c } of sorted) {
        if (c.hidden) continue;
        const info = this.engineProfileFor(c.id);
        this.audio.engine(c.id, info, c.pos, Math.abs(c.fwdSpeed || 0), c.throttle || 0, c.boosting, c.id === myPid);
      }
      this.audio.sweepEngines();
    } else this.audio.stopAllEngines();
    if (!this.skipRender) R.draw(view, dt);
  }

  // Test helper: advance the game by `sec` seconds at a fixed 60 Hz without rendering intermediate frames.
  debugAdvance(sec, controls = {}, ui = {}) {
    const ctl = { throttle: 0, steer: 0, pitch: 0, yaw: 0, roll: 0, jump: false, boost: false, slide: false, ...controls };
    const u = { ballCamToggle: false, lookBack: false, scoreboard: false, pause: false, chat: false, ballCam: this.input.ballCam, ...ui };
    this.skipRender = true;
    const n = Math.round(sec * 60);
    this.dbgNow = this.dbgNow || performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      this.dbgNow += 1 / 60;
      if (i === n - 1) this.skipRender = false;
      if (this.mode === 'session') this.sessionFrame(1 / 60, ctl, u, this.dbgNow);
      else if (this.mode === 'training') this.trainingFrame(1 / 60, ctl, u, this.dbgNow);
    }
    this.skipRender = false;
    return this.session?.world ? { state: this.session.world.match.state, score: this.session.world.match.score, clock: this.session.world.match.clock } : this.training ? { round: this.training.round } : null;
  }

  engineProfileFor(pid) {
    const S = this.session;
    if (!S) return this.profile.loadout.engine;
    const r = S.roster?.find((x) => x.pid === pid);
    return r?.cos?.engine || 'v8';
  }

  presentWorldEvents(events, myPid) {
    const R = this.renderer, A = this.audio;
    const carPos = (id) => { const c = this.view?.cars.find((x) => x.id === id); return c ? c.pos : null; };
    this.touchCd = this.touchCd || new Map();
    for (const e of events) {
      switch (e.type) {
        case 'jump': A.play('jump', { pos: carPos(e.car) }); break;
        case 'dodge': A.play('dodge', { pos: carPos(e.car) }); break;
        case 'land': if (e.speed > 3) { A.play('land', { pos: carPos(e.car), strength: e.speed }); const p = carPos(e.car); if (p) R.dust(p); } break;
        case 'touch': {
          const last = this.touchCd.get(e.car) || 0;
          if (performance.now() - last > 150) { this.touchCd.set(e.car, performance.now()); A.play('ball', { pos: e, strength: e.strength }); if (e.strength > 2) R.impact(e, e.strength); if (e.strength > 12 && e.car === myPid) R.rig?.addShake(0.4, this.settings); }
          break;
        }
        case 'ballWall': if (e.speed > 6) A.play('ballWall', { pos: e, strength: e.speed }); break;
        case 'carWall': if (e.car === myPid && e.speed > 6) A.play('carWall', { pos: carPos(e.car), strength: e.speed }); break;
        case 'bump': A.play('bump', { pos: carPos(e.a), strength: e.speed }); if (e.a === myPid || e.b === myPid) R.rig?.addShake(Math.min(1, e.speed / 12), this.settings); break;
        case 'pickup': { const pad = (this.session?.world || this.training?.world).arena.pads[e.pad]; R.pickup(pad, e.large); if (e.car === myPid) A.play('pickup', { large: e.large }); break; }
        case 'boostOff': if (e.car === myPid && e.empty) A.play('boostEmpty'); break;
        case 'respawn': { const c = this.view?.cars.find((x) => x.id === e.car); const car = (this.session?.world || this.training?.world)?.car(e.car); if (car) R.respawnFx(car.pos, car.team); void c; break; }
        default: break;
      }
    }
  }

  onSessionEvent(e, now) {
    const S = this.session;
    switch (e.type) {
      case 'goal': {
        const scorer = e.scorer >= 0 ? S.playerName(e.scorer) : null, assist = e.assist >= 0 ? S.playerName(e.assist) : null;
        const sInfo = S.playerInfo(e.scorer);
        this.renderer.goal({ x: e.x, y: e.y, z: e.z }, e.team, (sInfo?.cos?.goal) || 'shock');
        if (!this.settings.reduceFlash) this.renderer.rig?.addShake(0.6, this.settings);
        this.audio.play('goal', { horn: sInfo?.cos?.horn || 'chime' });
        this.hud.goalBanner(e.team, scorer, assist, e.speed);
        this.hud.feedMsg(scorer ? `${scorer} scored${assist ? ' (assist ' + assist + ')' : ''}` : `${this.colors[e.team].name} scored`, this.colors[e.team].css);
        if (!this.settings.skipReplays) setTimeout(() => { if (this.session === S && S.world?.match.state === 'goal') this.replay.start(performance.now() / 1000); }, 1300);
        break;
      }
      case 'end': this.replay.playing = null; this.onMatchEnd(e.result); break;
      case 'demo': {
        const vic = S.playerInfo(e.victim), att = S.playerInfo(e.attacker);
        this.renderer.demolition(e, vic ? vic.team : 0);
        this.audio.play('demo', { pos: e });
        if (e.victim === S.pid || e.attacker === S.pid) this.renderer.rig?.addShake(0.8, this.settings);
        this.hud.feedMsg(`${att?.name || '?'} demolished ${vic?.name || '?'}`, att ? this.colors[att.team]?.css : null);
        break;
      }
      case 'chat': if (!this.settings.quickChatOff) { const info = S.playerInfo(e.pid); this.hud.feedMsg(`${info?.name || '?'}: ${e.text}`, info ? this.colors[info.team]?.css : null); this.audio.play('chat'); } break;
      case 'state':
        if (e.to === 'countdown') this.replay.playing = null;
        if (e.to === 'live' && e.from === 'countdown') { /* handled by countdown */ }
        break;
      case 'error': toast(e.msg || e.code, 'err', 4500); break;
      case 'closed': {
        const reason = e.reason;
        if (reason === 'left') return;
        const msg = { connection_lost: 'Connection to the match was lost.', host_left: 'The host left — match ended.', match_over: 'The match has ended.', empty: 'The match closed.', bad_code: 'No match found with that code.' }[reason] || 'Disconnected: ' + reason;
        toast(msg, reason === 'match_over' ? '' : 'err', 5000);
        // offer a reconnect for transport drops on the dedicated server
        if (reason === 'connection_lost' && this.sessionInfo?.via === 'server' && S.code && S.token) { this.tryReconnect(S.code, S.token); return; }
        if (this.resultsEl && reason === 'match_over') { const r = this.resultsEl; this.session = null; this.mode = 'menu'; this.hud.root.remove(); this.audio.stopAllEngines(); this.renderer.clearCars(); this.inMatchView = false; r.el.querySelectorAll('button').forEach((b) => { if (b.textContent === 'Rematch') b.disabled = true; }); this.go('main'); this.ui.appendChild(r.el); return; }
        this.leaveSession();
        break;
      }
      default: break;
    }
  }

  async tryReconnect(code, token) {
    toast('Reconnecting…');
    this.endSession(true);
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const ok = await this.detectServerOnly();
        if (!ok) continue;
        this.beginClient(wsConnect(`${this.serverWsBase()}?op=join&code=${code}`), { online: true, via: 'server', code, token });
        return;
      } catch { /* retry */ }
    }
    toast('Could not reconnect.', 'err');
    this.go('main');
  }
  async detectServerOnly() { try { const r = await fetch(this.serverWsBase().replace(/^ws/, 'http').replace(/\/ws$/, '/status'), { cache: 'no-store' }); return r.ok; } catch { return false; } }

  updateCountdown(W) {
    const m = W.match;
    if (m.state === 'countdown') {
      const n = Math.ceil(m.timer);
      if (n !== this.lastCount && n > 0) { this.lastCount = n; this.audio.play('countdown'); }
      this.goSince = 99;
    } else if (m.state === 'live' && this.lastCount > 0) { this.lastCount = 0; this.goSince = 0; this.audio.play('go'); }
    this.goSince += 1 / 60;
  }

  hudState(S, W, me, ui) {
    const m = W.match;
    return {
      kind: S.kind, score: m.score, clock: m.clock, overtime: m.overtime, waitingGround: m.waitingGround, state: m.state, timer: m.timer,
      boost: me ? me.boost : 0, hasCar: !!me && !(me.demoT > 0), demoT: me ? me.demoT : 0, roster: this.rosterWithConn(S), rtt: S.rtt, showPing: this.settings.showPing, code: S.code, priv: S.priv,
      goSince: this.goSince, kickoffText: m.overtime ? 'Overtime' : 'Kickoff', replay: !!this.replay.playing, replayHint: 'press Jump to skip',
      midText: m.state === 'ended' ? 'Full time' : m.waitingGround && m.state === 'live' ? 'Time is up — the match ends when the ball touches the ground' : '', quickChatOpen: this.quickChat, conn: S.closed ? 'lost' : 'ok',
    };
  }
}

// number keys for quick chat
window.addEventListener('keydown', (e) => {
  const app = window.__od;
  if (!app || !app.quickChat || !app.session) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= 9) { app.session.chatSend(n - 1); app.quickChat = false; e.preventDefault(); }
});

export function boot() {
  try { new App(); }
  catch (e) {
    console.error(e);
    document.body.appendChild(Object.assign(document.createElement('pre'), { textContent: 'Project Overdrive failed to start: ' + (e.stack || e), style: 'color:#f87171;padding:20px;position:fixed;inset:0;z-index:99;white-space:pre-wrap' }));
  }
}
boot();
