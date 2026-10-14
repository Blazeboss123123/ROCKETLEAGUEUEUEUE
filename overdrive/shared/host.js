// MatchHost: the authoritative game session. Owns the lobby (teams, ready-up), the World,
// bots, per-player input queues, snapshots, statistics, disconnect/reconnect and results.
//
// It is transport-agnostic: the Node dedicated server, a browser acting as host (via the
// artifact room) and offline play all drive the same class. A transport feeds validated
// client messages to handle(pid, msg), calls tick() at PHYSICS.tickRate, and delivers what
// it receives through out(pid | null, msg)   (null = broadcast).

import { PHYSICS, NET, MODES, MATCH, BOT_NAMES, ARENA_VARIANTS } from './config.js';
import { World, unpackInput, quantizeInput } from './world.js';
import { Bot } from './bot.js';
import { neutralInput } from './car.js';
import { validateClientMsg, cleanName, sanitizeCosmetics, makeCode, QUICK_CHAT } from './protocol.js';
import { rng } from './math.js';
import { log } from './log.js';

const TICK = PHYSICS.dt;

export class MatchHost {
  constructor(opts) {
    this.mode = MODES[opts.mode] ? opts.mode : '3v3';
    this.teamSize = MODES[this.mode].teamSize;
    this.kind = opts.kind || 'dedicated';        // 'dedicated' | 'browser' | 'offline'
    this.isPrivate = !!opts.isPrivate;
    this.rand = opts.rand || Math.random;
    this.code = opts.code || makeCode(this.rand);
    this.out = opts.out || (() => {});
    this.duration = opts.duration ?? MATCH.duration;
    this.fill = opts.fill || (this.isPrivate ? 'off' : 'pro'); // bot fill level
    this.autoStart = !!opts.autoStart;           // offline: start as soon as the creator joins
    this.lobbyTimeout = opts.lobbyTimeout ?? 25; // public lobbies start after this many seconds
    this.arena = ARENA_VARIANTS[opts.arena] ? opts.arena : 'stadium';
    if (!this.isPrivate && this.kind !== 'offline' && !ARENA_VARIANTS[this.arena].competitive) this.arena = 'stadium';
    this.arenaParams = ARENA_VARIANTS[this.arena].params;
    this.players = new Map();                    // pid -> player
    this.nextPid = 1;
    this.nextBotPid = 100;
    this.phase = 'lobby';                        // lobby | match | results | closed
    this.phaseTicks = 0;
    this.world = null;
    this.mid = 0;                                // match id (increments on rematch)
    this.ownerPid = 0;
    this.lobbyVersion = 0;
    this.emptyTicks = 0;
    this.onEmpty = opts.onEmpty || null;
    this.onEnd = opts.onEnd || null;
    this.snapEvery = Math.max(1, Math.round(PHYSICS.tickRate / (opts.snapshotRate || NET.snapshotRate)));
    this.lastResult = null;
  }

  // ---------------------------------------------------------------- roster
  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  connectedHumans() { return this.humans().filter((p) => p.connected); }
  teamCount(t) { return [...this.players.values()].filter((p) => p.team === t).length; }
  capacity() { return this.teamSize * 2; }

  join(name, cos, token) {
    // reconnection
    if (token) {
      for (const p of this.players.values()) {
        if (!p.bot && p.token === token) {
          p.connected = true; p.discTicks = 0; p.botCtl = null; p.queue = []; p.left = false;
          p.name = cleanName(name) || p.name; p.cos = sanitizeCosmetics(cos);
          log('net', 'player reconnected', { pid: p.pid, code: this.code });
          this.afterJoin(p);
          return { pid: p.pid, token: p.token, reconnected: true };
        }
      }
    }
    if (this.phase === 'closed') return { error: 'closed' };
    // take over a bot slot mid-match or in lobby if full
    const humans = this.humans().length;
    if (humans >= this.capacity()) return { error: 'full' };
    let team = this.teamCount(0) <= this.teamCount(1) ? 0 : 1;
    const botToReplace = this.phase !== 'lobby' || this.teamCount(0) + this.teamCount(1) >= this.capacity()
      ? [...this.players.values()].find((p) => p.bot && !p.humanSlot) : null;
    if (this.phase !== 'lobby' && !botToReplace && this.teamCount(0) >= this.teamSize && this.teamCount(1) >= this.teamSize) return { error: 'full' };
    let pid;
    if (botToReplace) { pid = botToReplace.pid; team = botToReplace.team; this.players.delete(pid); }
    else pid = this.nextPid++;
    const p = {
      pid, name: cleanName(name), cos: sanitizeCosmetics(cos), team, ready: false, bot: false, connected: true,
      token: Math.floor(this.rand() * 2 ** 52).toString(36) + Math.floor(this.rand() * 2 ** 52).toString(36),
      queue: [], lastSeq: -1, lastQueued: -1, lastInput: neutralInput(), discTicks: 0, botCtl: null, ping: 0,
      chatTicks: 0, rematch: false, left: false, violations: 0,
    };
    this.players.set(pid, p);
    if (!this.ownerPid) this.ownerPid = pid;
    if (this.world && !this.world.car(pid)) this.world.addCar(pid, team);
    log('match', 'player joined', { pid, code: this.code, phase: this.phase });
    this.afterJoin(p);
    if (this.autoStart && this.phase === 'lobby') this.startMatch();
    return { pid, token: p.token };
  }

  afterJoin(p) {
    this.out(p.pid, { t: 'welcome', pid: p.pid, token: p.token, code: this.code, mode: this.mode, kind: this.kind, priv: this.isPrivate });
    this.bumpLobby();
    if (this.world) {
      this.out(p.pid, this.startMsg());
      this.out(p.pid, this.statsMsg());
    }
    if (this.phase === 'results' && this.lastResult) this.out(p.pid, this.lastResult);
  }

  addBot(team, level = 'pro', humanSlot = false) {
    const pid = this.nextBotPid++;
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `Bot ${pid}`;
    const p = { pid, name, cos: botCosmetics(pid), team, ready: true, bot: true, level, connected: true, botCtl: new Bot(pid, level, pid), ping: 0, humanSlot };
    this.players.set(pid, p);
    if (this.world) this.world.addCar(pid, team);
    return p;
  }

  fillBots() {
    if (this.fill === 'off') return;
    for (const t of [0, 1]) while (this.teamCount(t) < this.teamSize) this.addBot(t, this.fill);
  }

  removePlayer(pid, reason) {
    const p = this.players.get(pid);
    if (!p) return;
    if (this.phase === 'match' && !p.bot) {
      // keep the car on the pitch under bot control so the match stays fair-ish and can end
      p.left = true; p.connected = false; p.botCtl = new Bot(pid, 'pro', pid); p.discTicks = 1e9;
      p.name = p.name.replace(/ \(left\)$/, '') + ' (left)';
    } else {
      this.players.delete(pid);
      if (this.world) this.world.removeCar(pid);
    }
    if (this.ownerPid === pid) this.ownerPid = this.humans().filter((h) => h.connected)[0]?.pid || 0;
    log('match', 'player removed', { pid, reason, code: this.code });
    this.bumpLobby();
  }

  disconnect(pid) {
    const p = this.players.get(pid);
    if (!p || p.bot) return;
    if (this.phase === 'lobby') { this.removePlayer(pid, 'disconnect-lobby'); return; }
    p.connected = false; p.discTicks = 0; p.queue = []; // a disconnected player can no longer affect the match
    this.world?.setInput(pid, neutralInput());
    log('net', 'player disconnected', { pid, code: this.code });
    this.bumpLobby();
  }

  // ---------------------------------------------------------------- messages
  handle(pid, raw) {
    const p = this.players.get(pid);
    if (!p || p.bot || !p.connected) return;
    const m = validateClientMsg(raw);
    if (!m) { p.violations = (p.violations || 0) + 1; return 'invalid'; }
    switch (m.t) {
      case 'in': return this.onInput(p, m);
      case 'ping': this.out(pid, { t: 'pong', c: m.c, s: this.world ? this.world.tick : 0 }); return;
      case 'ready':
        if (this.phase !== 'lobby') return;
        p.ready = m.v; this.bumpLobby(); return;
      case 'team':
        if (this.phase !== 'lobby' || p.team === m.v) return;
        if (this.teamCount(m.v) >= this.teamSize) return this.out(pid, { t: 'error', code: 'team_full', msg: 'That team is full.' });
        p.team = m.v; p.ready = false; this.bumpLobby(); return;
      case 'fill':
        if (pid !== this.ownerPid || this.phase !== 'lobby') return;
        this.fill = m.v; this.bumpLobby(); return;
      case 'start':
        if (this.phase !== 'lobby' || pid !== this.ownerPid) return;
        if (!this.connectedHumans().every((h) => h.ready)) return this.out(pid, { t: 'error', code: 'not_ready', msg: 'Everyone must be ready.' });
        this.startMatch(); return;
      case 'chat':
        if (p.chatTicks > 0) return;
        p.chatTicks = 60;
        this.out(null, { t: 'chat', pid, q: m.q, text: QUICK_CHAT[m.q] }); return;
      case 'rematch':
        if (this.phase !== 'results') return;
        p.rematch = true; this.bumpLobby();
        if (this.connectedHumans().every((h) => h.rematch)) this.startMatch();
        return;
      case 'tolobby':
        if (this.phase !== 'results' || pid !== this.ownerPid) return;
        this.phase = 'lobby'; this.phaseTicks = 0; this.world = null; this.purgeLeft();
        for (const pl of this.players.values()) if (!pl.bot) pl.ready = false;
        this.bumpLobby(); return;
      case 'leave': this.removePlayer(pid, 'left'); this.out(pid, { t: 'closed', reason: 'left' }); return;
      default: return;
    }
  }

  onInput(p, m) {
    if (!this.world || this.phase !== 'match') return;
    // accept only inputs newer than anything already queued; old/duplicate ones are stale
    for (let k = 0; k < m.i.length; k++) {
      const seq = m.s + k;
      if (seq <= p.lastQueued) continue;
      if (p.lastQueued >= 0 && seq > p.lastQueued + 240) { p.violations++; return 'invalid'; } // absurd jump
      p.queue.push({ seq, inp: unpackInput(m.i[k]) });
      p.lastQueued = seq;
    }
    if (p.queue.length > NET.maxInputQueue) p.queue.splice(0, p.queue.length - NET.maxInputQueue);
  }

  // ---------------------------------------------------------------- flow
  bumpLobby() {
    this.lobbyVersion++;
    this.out(null, this.lobbyMsg());
  }

  lobbyMsg() {
    const players = [...this.players.values()].map((p) => ({
      pid: p.pid, name: p.name, team: p.team, ready: !!p.ready, bot: !!p.bot, level: p.level, conn: !!p.connected,
      cos: p.cos, ping: p.ping | 0, rematch: !!p.rematch,
    }));
    const left = this.phase === 'lobby' && !this.isPrivate && this.kind !== 'offline'
      ? Math.max(0, this.lobbyTimeout - this.phaseTicks * TICK) : null;
    return { t: 'lobby', v: this.lobbyVersion, code: this.code, mode: this.mode, phase: this.phase, priv: this.isPrivate, kind: this.kind, owner: this.ownerPid, fill: this.fill, players, startsIn: left };
  }

  startMsg() {
    const roster = [...this.players.values()].map((p) => ({ pid: p.pid, name: p.name, team: p.team, bot: !!p.bot, cos: p.cos }));
    return { t: 'start', mid: this.mid, seed: this.world.seed, mode: this.mode, duration: this.duration, roster, kind: this.kind, arena: this.arena };
  }

  statsMsg() {
    const stats = {}, ping = {}, conn = {};
    for (const p of this.players.values()) {
      stats[p.pid] = this.world?.stats.get(p.pid) || null;
      ping[p.pid] = p.ping | 0; conn[p.pid] = p.bot ? 2 : p.connected ? 1 : p.botCtl ? 3 : 0;
    }
    const roster = [...this.players.values()].map((p) => ({ pid: p.pid, name: p.name, team: p.team, bot: !!p.bot, cos: p.cos }));
    return { t: 'stats', mid: this.mid, stats, ping, conn, roster };
  }

  startMatch() {
    this.fillBots();
    if (this.teamCount(0) + this.teamCount(1) === 0) return;
    this.mid++;
    const seed = Math.floor(this.rand() * 1e9);
    this.world = new World({ seed, duration: this.duration, arenaParams: this.arenaParams });
    for (const p of [...this.players.values()].sort((a, b) => a.pid - b.pid)) {
      this.world.addCar(p.pid, p.team);
      p.queue = []; p.lastSeq = -1; p.lastQueued = -1; p.rematch = false; p.ready = false;
    }
    this.world.startMatch();
    this.phase = 'match';
    this.phaseTicks = 0;
    log('match', 'match started', { code: this.code, mid: this.mid, players: this.players.size });
    this.out(null, this.startMsg());
    this.bumpLobby();
  }

  // ---------------------------------------------------------------- tick
  tick() {
    this.phaseTicks++;
    for (const p of this.players.values()) if (p.chatTicks > 0) p.chatTicks--;

    // empty-session detection
    if (this.connectedHumans().length === 0 && this.kind !== 'offline') {
      if (++this.emptyTicks > PHYSICS.tickRate * 15 && this.phase !== 'closed') this.close('empty');
    } else this.emptyTicks = 0;

    if (this.phase === 'lobby') {
      if (!this.isPrivate && this.kind !== 'offline') {
        const humans = this.connectedHumans();
        const everyoneReady = humans.length > 0 && humans.every((h) => h.ready);
        const full = humans.length >= this.capacity();
        if ((full && everyoneReady) || (humans.length > 0 && this.phaseTicks * TICK >= this.lobbyTimeout) || (everyoneReady && humans.length > 1)) this.startMatch();
        else if (this.phaseTicks % PHYSICS.tickRate === 0) this.out(null, this.lobbyMsg());
      }
      return;
    }
    if (this.phase === 'results') {
      if (this.phaseTicks * TICK > 45) {
        if (this.isPrivate || this.kind === 'offline') { this.phase = 'lobby'; this.phaseTicks = 0; this.world = null; for (const p of this.players.values()) if (!p.bot) p.ready = false; this.purgeLeft(); this.bumpLobby(); }
        else this.close('match_over');
      }
      return;
    }
    if (this.phase !== 'match') return;

    const w = this.world;
    // inputs: humans from queues, bots and disconnected players from AI
    for (const p of this.players.values()) {
      if (!p.connected && !p.bot) {
        p.discTicks++;
        if (!p.botCtl && p.discTicks > NET.botTakeoverDelay * PHYSICS.tickRate) p.botCtl = new Bot(p.pid, 'pro', p.pid);
        if (!p.left && p.discTicks > NET.disconnectGrace * PHYSICS.tickRate) { p.left = true; p.name += ' (left)'; this.bumpLobby(); }
      }
      if (p.bot || p.botCtl) {
        w.setInput(p.pid, quantizeInput((p.botCtl).think(w)));
        continue;
      }
      if (!p.connected) { w.setInput(p.pid, neutralInput()); continue; }
      // jitter buffer: consume one input per tick; catch up when the queue grows
      if (p.queue.length > NET.targetInputQueue + 4) p.queue.shift().seq;
      const next = p.queue.shift();
      if (next) { p.lastInput = next.inp; p.lastSeq = next.seq; }
      w.setInput(p.pid, p.lastInput);
    }
    w.step();
    w.events.length = 0;

    if (w.tick % this.snapEvery === 0) {
      w.quantize();
      const acks = {};
      for (const p of this.players.values()) if (!p.bot && p.connected) acks[p.pid] = p.lastSeq;
      this.out(null, { t: 'snap', s: w.serialize(), a: acks });
    }
    if (w.tick % PHYSICS.tickRate === 0) this.out(null, this.statsMsg());

    if (w.match.state === 'ended') this.finish();
  }

  finish() {
    const w = this.world;
    const stats = {};
    for (const p of this.players.values()) stats[p.pid] = w.stats.get(p.pid) || null;
    const roster = [...this.players.values()].map((p) => ({ pid: p.pid, name: p.name, team: p.team, bot: !!p.bot, cos: p.cos }));
    this.lastResult = { t: 'end', mid: this.mid, score: [...w.match.score], winner: w.winner(), overtime: w.match.overtime, stats, roster, kind: this.kind };
    this.phase = 'results';
    this.phaseTicks = 0;
    // final snapshot so everyone sees the final state
    w.quantize();
    this.out(null, { t: 'snap', s: w.serialize(), a: {} });
    this.out(null, this.lastResult);
    log('match', 'match finished', { code: this.code, score: w.match.score });
    this.bumpLobby();
    if (this.onEnd) this.onEnd(this.lastResult);
  }

  purgeLeft() {
    for (const p of [...this.players.values()]) if (!p.bot && (p.left || !p.connected)) this.players.delete(p.pid);
    for (const p of [...this.players.values()]) if (p.bot && !this.isPrivate) this.players.delete(p.pid);
  }

  setPing(pid, ms) { const p = this.players.get(pid); if (p) p.ping = ms; }

  close(reason) {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.out(null, { t: 'closed', reason });
    log('match', 'session closed', { code: this.code, reason });
    if (this.onEmpty) this.onEmpty(reason);
  }
}

const PAINTS = [0xd9d9d9, 0x222222, 0x8a2be2, 0x10b981, 0xe11d48, 0x0ea5e9, 0xf59e0b];
function botCosmetics(pid) {
  const r = rng(pid * 13);
  const pick = (a) => a[Math.floor(r() * a.length)];
  return { body: pick(['comet', 'strider', 'rampart', 'vanta', 'wisp']), paint: pick(PAINTS), finish: pick(['gloss', 'matte', 'metal']), wheels: pick(['spoke', 'turbine', 'disc', 'tri', 'mesh']), trail: pick(['ion', 'ember', 'arc', 'vapour', 'prism']), antenna: 'none', topper: 'none', decal: pick(['none', 'stripe', 'hex']) };
}
