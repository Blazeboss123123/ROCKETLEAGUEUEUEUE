// Browser-hosted multiplayer over the claude.ai artifact `room` capability.
//
// One player's browser runs the authoritative MatchHost; everyone else is a client.
// The room's presence channel (latest-value-wins, ~30 updates/s, may drop) carries:
//   host presence:   {od: protocol, hc: code, mm: matchmaking ad, ws: welcomes, lb, st, sn, ak, ss, en, pg, ch}
//   client presence: {c: {h: hello, r: ready, tm: team, go, fl, rm, ch, pg, in}}
// Everything is treated as untrusted input: the host validates client data exactly like the
// dedicated server does, and clients never send state — only intentions and inputs.

import { MatchHost } from '../../shared/host.js';
import { localPair } from '../../shared/client.js';
import { PROTOCOL_VERSION, CODE_RE, makeCode } from '../../shared/protocol.js';
import { PHYSICS } from '../../shared/config.js';
import { log } from '../../shared/log.js';

const COS_KEYS = ['body', 'paint', 'accent', 'finish', 'wheels', 'wheelColor', 'trail', 'goal', 'engine', 'antenna', 'decal', 'topper', 'glow', 'banner', 'title', 'horn'];
export const packCos = (c) => COS_KEYS.map((k) => (c && c[k] !== undefined ? c[k] : null));
export const unpackCos = (a) => { const o = {}; if (Array.isArray(a)) COS_KEYS.forEach((k, i) => { if (a[i] !== null && a[i] !== undefined) o[k] = a[i]; }); return o; };
const packRoster = (r) => r.map((p) => [p.pid, p.name, p.team, p.bot ? 1 : 0, packCos(p.cos)]);
const unpackRoster = (a) => (Array.isArray(a) ? a.map((p) => ({ pid: p[0], name: p[1], team: p[2], bot: !!p[3], cos: unpackCos(p[4]) })) : []);
const STAT_KEYS = ['score', 'goals', 'assists', 'saves', 'shots', 'touches', 'boost', 'demos'];
const packStats = (s) => { const o = {}; for (const k in s) o[k] = s[k] ? STAT_KEYS.map((x) => Math.round(s[k][x] || 0)) : null; return o; };
const unpackStats = (s) => { const o = {}; for (const k in s || {}) o[k] = s[k] ? Object.fromEntries(STAT_KEYS.map((x, i) => [x, s[k][i] || 0])) : null; return o; };

let roomPromise = null;
export function getRoom() {
  if (!roomPromise) {
    roomPromise = (async () => {
      try {
        if (!window.claude || typeof window.claude.use !== 'function') return null;
        return await window.claude.use('room');
      } catch (e) { log('net', 'room capability unavailable', String(e)); return null; }
    })();
  }
  return roomPromise;
}

// ------------------------------------------------------------------ host side
export class RoomHost {
  constructor({ room, mode, game, isPrivate, fill, arena, code }) {
    this.room = room;
    this.code = code || makeCode();
    this.peerToPid = new Map();
    this.pidToPeer = new Map();
    this.lastClient = new Map(); // peer -> last processed client presence fields
    this.slots = { ws: {}, pg: {}, ch: null };
    this.dirty = true;
    this.chatSeq = 0;
    this.host = new MatchHost({
      mode, game, isPrivate, fill, code: this.code, kind: 'browser', arena,
      out: (target, msg) => this.onOut(target, msg),
    });
    this.local = localPair(this.host);
    this.closed = false;
  }

  async open() {
    this.joined = await this.room.join('od-' + this.code.toLowerCase());
    this.unsub = this.joined.onPeers((ch) => this.onPeers(ch), (e) => { log('net', 'room error', e); });
    this.publish(true);
    return this;
  }

  // messages from the MatchHost
  onOut(target, msg) {
    this.local.deliver(target, msg); // the host's own player
    const s = this.slots;
    switch (msg.t) {
      case 'welcome': { const peer = this.pidToPeer.get(msg.pid) || this.pendingPeer; if (peer) s.ws[peer] = [msg.pid, msg.token, msg.code, msg.mode, msg.priv ? 1 : 0]; break; }
      case 'lobby': s.lb = [msg.v, msg.phase, msg.owner, msg.fill, msg.startsIn == null ? -1 : Math.round(msg.startsIn), msg.players.map((p) => [p.pid, p.name, p.team, p.ready ? 1 : 0, p.bot ? 1 : 0, p.conn ? 1 : 0, p.rematch ? 1 : 0, p.ping | 0]), msg.mode, msg.priv ? 1 : 0, msg.game, msg.arena]; break;
      case 'start': s.st = [msg.mid, msg.seed, msg.mode, msg.duration, packRoster(msg.roster), msg.arena || 'stadium', msg.game || 'soccar']; break;
      case 'snap': s.sn = msg.s; s.ak = msg.a; break;
      case 'stats': s.ss = [msg.mid, packStats(msg.stats), msg.ping, msg.conn]; break;
      case 'end': s.en = [msg.mid, msg.score, msg.winner, msg.overtime ? 1 : 0, packStats(msg.stats), packRoster(msg.roster)]; break;
      case 'pong': if (target !== null) s.pg[target] = msg.c; break;
      case 'chat': s.ch = [++this.chatSeq, msg.pid, msg.text]; break;
      case 'closed': s.cl = msg.reason; break;
      case 'error': if (target !== null) { s.er = s.er || {}; s.er[target] = [msg.code, msg.msg, Date.now() % 1e6]; } break;
      default: break;
    }
    this.dirty = true;
    if (msg.t === 'snap' || msg.t === 'lobby' || msg.t === 'start' || msg.t === 'end' || msg.t === 'closed') this.publish();
  }

  publish(force) {
    if (!this.joined || (!this.dirty && !force)) return;
    this.dirty = false;
    const s = this.slots, h = this.host;
    // in a match the lobby list is redundant with the start roster; keep presence under 4 KiB
    const p = { od: PROTOCOL_VERSION, hc: this.code, ws: s.ws, pg: s.pg, lb: h.phase === 'match' ? null : s.lb ?? null,
      st: h.phase === 'lobby' ? null : s.st ?? null, sn: h.phase === 'match' ? s.sn ?? null : null, ak: h.phase === 'match' ? s.ak ?? null : null,
      ss: s.ss ?? null, en: h.phase === 'results' ? s.en ?? null : null, ch: s.ch, cl: s.cl ?? null, er: s.er ?? null };
    const size = JSON.stringify(p).length;
    if (size > 3900) { p.ss = null; p.pg = {}; }
    this.joined.presence(p).catch((e) => log('net', 'presence publish failed', String(e?.code || e)));
  }

  onPeers(change) {
    for (const peer of change.left) {
      const pid = this.peerToPid.get(peer.peer);
      if (pid) { this.host.disconnect(pid); this.peerToPid.delete(peer.peer); this.pidToPeer.delete(pid); delete this.slots.ws[peer.peer]; }
      this.lastClient.delete(peer.peer);
    }
    for (const peer of [...change.joined, ...change.updated]) {
      if (peer.sameTab) continue;
      const c = peer.presence && peer.presence.c;
      if (!c || typeof c !== 'object') continue;
      this.onClient(peer.peer, c);
    }
  }

  onClient(peer, c) {
    const last = this.lastClient.get(peer) || {};
    let pid = this.peerToPid.get(peer);
    if (!pid) {
      if (!Array.isArray(c.h) || c.h[3] !== this.code) return;
      this.pendingPeer = peer;
      const res = this.host.join(String(c.h[0] || ''), unpackCos(c.h[1]), typeof c.h[2] === 'string' ? c.h[2] : null);
      this.pendingPeer = null;
      if (res.error) { this.slots.ws[peer] = [0, '', this.code, this.host.mode, 0, res.error]; this.dirty = true; this.publish(); return; }
      pid = res.pid;
      this.peerToPid.set(peer, pid); this.pidToPeer.set(pid, peer);
      this.slots.ws[peer] = [pid, res.token, this.code, this.host.mode, this.host.isPrivate ? 1 : 0];
      this.dirty = true; this.publish();
    }
    const h = (m) => this.host.handle(pid, m);
    if (c.r !== last.r) h({ t: 'ready', v: !!c.r });
    if (c.tm !== last.tm && (c.tm === 0 || c.tm === 1)) h({ t: 'team', v: c.tm });
    if (c.go !== last.go && c.go) h({ t: 'start' });
    if (c.fl !== last.fl && c.fl) h({ t: 'fill', v: c.fl });
    if (c.rm !== last.rm && c.rm) h({ t: 'rematch' });
    if (Array.isArray(c.ch) && (!last.ch || c.ch[0] !== last.ch[0])) h({ t: 'chat', q: c.ch[1] });
    if (c.pg !== last.pg && Number.isFinite(c.pg)) h({ t: 'ping', c: c.pg });
    if (c.in && (!last.in || c.in.s !== last.in.s || c.in.i?.length !== last.in.i?.length)) h({ t: 'in', s: c.in.s, i: c.in.i });
    if (c.tl !== last.tl && c.tl) h({ t: 'tolobby' });
    if (c.lv && !last.lv) { h({ t: 'leave' }); }
    this.lastClient.set(peer, c);
  }

  tick() { if (!this.closed) this.host.tick(); }
  advertise(mainRoom) {
    // public matchmaking advert in the shared lobby room
    const h = this.host;
    const open = !h.isPrivate && (h.phase === 'lobby' || h.phase === 'match') && h.humans().length < h.capacity();
    mainRoom.presence({ mm: open ? { code: this.code, mode: h.game + ':' + h.mode, n: h.connectedHumans().length, cap: h.capacity(), ph: h.phase } : null }).catch(() => {});
  }
  close() {
    this.closed = true;
    this.host.close('host_left');
    this.publish(true);
    setTimeout(() => { this.unsub?.(); this.joined?.leave?.(); }, 400);
  }
}

// ------------------------------------------------------------------ client side
// A connection object for ClientSession that speaks through a named room.
export class RoomClientConn {
  constructor(room, code) {
    this.room = room; this.code = code;
    this.state = {}; this.session = null;
    this.hostPeer = null; this.lastHost = {}; this.seen = { snapTick: -1, st: -1, en: -1, lb: -1, ss: -1, ch: -1, pg: null, er: -1 };
    this.pid = 0; this.closedSent = false;
  }
  attach(s) { this.session = s; }
  async open(timeoutMs = 9000) {
    this.joined = await this.room.join('od-' + this.code.toLowerCase());
    this.unsub = this.joined.onPeers((ch) => this.onPeers(ch), (e) => this.fail('room_error'));
    this.timer = setTimeout(() => { if (!this.hostPeer) this.fail('bad_code'); }, timeoutMs);
    this.flush();
  }
  fail(reason) {
    if (this.closedSent) return;
    this.closedSent = true;
    if (reason === 'bad_code') this.session?.receive({ t: 'error', code: 'bad_code', msg: 'No match is being hosted with that code.' });
    this.session?.receive({ t: 'closed', reason });
  }
  send(m) {
    const st = this.state;
    switch (m.t) {
      case 'hello': st.h = [m.name, packCos(m.cos), m.token || null, this.code]; break;
      case 'ready': st.r = m.v ? 1 : 0; break;
      case 'team': st.tm = m.v; break;
      case 'start': st.go = (st.go || 0) + 1; break;
      case 'fill': st.fl = m.v; break;
      case 'rematch': st.rm = (st.rm || 0) + 1; break;
      case 'chat': st.ch = [((st.ch && st.ch[0]) || 0) + 1, m.q]; break;
      case 'ping': st.pg = Math.round(m.c); break;
      case 'in': {
        // carry more history than the WebSocket path: presence is coalesced and may drop
        const hist = (this.inHist = this.inHist || []);
        m.i.forEach((x, k) => hist.push([m.s + k, x]));
        while (hist.length > 16) hist.shift();
        const uniq = []; let s0 = null;
        for (const [seq, x] of hist) { if (s0 === null) s0 = seq; if (seq === s0 + uniq.length) uniq.push(x); else { uniq.length = 0; s0 = seq; uniq.push(x); } }
        st.in = { s: s0, i: uniq };
        break;
      }
      case 'tolobby': st.tl = (st.tl || 0) + 1; break;
      case 'leave': st.lv = 1; break;
      default: return;
    }
    this.flush();
  }
  flush() { if (this.joined) this.joined.presence({ c: { ...this.state } }).catch(() => {}); }
  close() { this.state.lv = 1; this.flush(); setTimeout(() => { this.unsub?.(); this.joined?.leave?.(); }, 300); clearTimeout(this.timer); }

  onPeers(change) {
    for (const p of change.left) if (p.peer === this.hostPeer) { this.session?.receive({ t: 'error', code: 'host_left', msg: 'The host left the match.' }); this.fail('host_left'); }
    for (const p of change.peers) {
      if (p.sameTab) continue;
      const pr = p.presence || {};
      if (pr.hc !== this.code || pr.od !== PROTOCOL_VERSION) continue;
      if (!this.hostPeer) { this.hostPeer = p.peer; clearTimeout(this.timer); }
      if (p.peer !== this.hostPeer) continue;
      if (pr === this.lastHost) continue;
      this.lastHost = pr;
      this.fromHost(pr, change.peers.find((x) => x.sameTab)?.peer);
    }
  }

  fromHost(pr, myPeer) {
    const S = this.session; if (!S) return;
    const seen = this.seen;
    const w = myPeer && pr.ws && pr.ws[myPeer];
    if (w && !this.pid) {
      if (w[5]) { S.receive({ t: 'error', code: w[5], msg: w[5] === 'full' ? 'That match is full.' : 'Could not join.' }); this.fail(w[5]); return; }
      this.pid = w[0];
      S.receive({ t: 'welcome', pid: w[0], token: w[1], code: w[2], mode: w[3], kind: 'browser', priv: !!w[4] });
    }
    if (!this.pid) return;
    if (Array.isArray(pr.lb) && pr.lb[0] !== seen.lb) {
      seen.lb = pr.lb[0];
      const [v, phase, owner, fill, startsIn, players, mode, priv, game, arena] = pr.lb;
      S.receive({ t: 'lobby', v, phase, owner, fill, startsIn: startsIn < 0 ? null : startsIn, mode, game, arena, priv: !!priv, kind: 'browser', code: this.code,
        players: players.map((p) => ({ pid: p[0], name: p[1], team: p[2], ready: !!p[3], bot: !!p[4], conn: !!p[5], rematch: !!p[6], ping: p[7] })) });
    }
    if (Array.isArray(pr.st) && pr.st[0] !== seen.st) {
      seen.st = pr.st[0];
      const roster = unpackRoster(pr.st[4]);
      S.receive({ t: 'start', mid: pr.st[0], seed: pr.st[1], mode: pr.st[2], duration: pr.st[3], roster, arena: pr.st[5] || null, game: pr.st[6] || 'soccar', kind: 'browser' });
      // lobby phase implied by a running match
      if (S.lobby) S.lobby = { ...S.lobby, phase: 'match' };
      else S.lobby = { phase: 'match', players: roster.map((r) => ({ ...r, ready: true, conn: true })), code: this.code, kind: 'browser' };
    }
    if (Array.isArray(pr.sn) && pr.sn[0] !== seen.snapTick) { seen.snapTick = pr.sn[0]; S.receive({ t: 'snap', s: pr.sn, a: pr.ak || {} }); }
    if (Array.isArray(pr.ss)) { const k = JSON.stringify(pr.ss[1]) + JSON.stringify(pr.ss[2]) + pr.ss[0]; if (k !== seen.ss) { seen.ss = k; S.receive({ t: 'stats', mid: pr.ss[0], stats: unpackStats(pr.ss[1]), ping: pr.ss[2], conn: pr.ss[3], roster: S.roster }); } }
    if (Array.isArray(pr.en) && pr.en[0] !== seen.en) {
      seen.en = pr.en[0];
      S.receive({ t: 'end', mid: pr.en[0], score: pr.en[1], winner: pr.en[2], overtime: !!pr.en[3], stats: unpackStats(pr.en[4]), roster: unpackRoster(pr.en[5]), kind: 'browser' });
      if (S.lobby) S.lobby = { ...S.lobby, phase: 'results' };
    }
    if (pr.pg && pr.pg[this.pid] && pr.pg[this.pid] !== seen.pg) { seen.pg = pr.pg[this.pid]; S.receive({ t: 'pong', c: pr.pg[this.pid] }); }
    if (Array.isArray(pr.ch) && pr.ch[0] !== seen.ch) { seen.ch = pr.ch[0]; S.receive({ t: 'chat', pid: pr.ch[1], text: pr.ch[2] }); }
    if (pr.er && pr.er[this.pid] && pr.er[this.pid][2] !== seen.er) { seen.er = pr.er[this.pid][2]; S.receive({ t: 'error', code: pr.er[this.pid][0], msg: pr.er[this.pid][1] }); }
    if (pr.cl) { this.session?.receive({ t: 'error', code: 'host_closed', msg: 'The host closed the match.' }); this.fail(pr.cl); }
  }
}

// ------------------------------------------------------------------ matchmaking in the shared room
// Seekers look for an advertised public lobby of the right mode; if none appears quickly they
// host one themselves. Ties (two seekers hosting at once) resolve towards the lowest peer label.
export async function findPublicMatch(room, mode, onStatus, waitMs = 3500) {
  room.presence({ seek: mode }).catch(() => {});
  const t0 = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      const ads = room.peers().filter((p) => !p.sameTab && p.presence && p.presence.mm && p.presence.mm.mode === mode && p.presence.mm.n < p.presence.mm.cap && CODE_RE.test(p.presence.mm.code));
      ads.sort((a, b) => (a.peer < b.peer ? -1 : 1));
      if (ads.length) { clearInterval(iv); room.presence({ seek: null }).catch(() => {}); resolve({ join: ads[0].presence.mm.code }); return; }
      const others = room.peers().filter((p) => !p.sameTab && p.presence && p.presence.seek === mode).length;
      onStatus?.({ elapsed: (Date.now() - t0) / 1000, searching: others + 1 });
      if (Date.now() - t0 > waitMs) { clearInterval(iv); room.presence({ seek: null }).catch(() => {}); resolve({ host: true }); }
    };
    const iv = setInterval(check, 250);
    check();
  });
}

// If we host a public lobby alone and someone else advertises one too, merge into the older one.
export function shouldYield(room, myHost) {
  if (myHost.host.isPrivate || myHost.host.connectedHumans().length > 1 || myHost.host.phase !== 'lobby') return null;
  const me = room.peers().find((p) => p.sameTab);
  const rivals = room.peers().filter((p) => !p.sameTab && p.presence?.mm && p.presence.mm.mode === myHost.host.game + ':' + myHost.host.mode && p.presence.mm.ph === 'lobby' && p.presence.mm.n < p.presence.mm.cap);
  const winner = rivals.find((p) => me && p.peer < me.peer);
  return winner ? winner.presence.mm.code : null;
}

export const ROOM_TICK = PHYSICS.dt;
