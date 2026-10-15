#!/usr/bin/env node
// Project Overdrive dedicated server.
//   node server/server.js [--port 8080] [--host 0.0.0.0] [--lag 0] [--jitter 0] [--loss 0]
//                         [--snapshot-rate 30] [--quiet]
// Serves the game client over HTTP and runs authoritative matches over WebSocket (/ws).
// No third-party dependencies.
//
// WebSocket URL forms (the first client message is always {t:'hello', ...}):
//   /ws?op=queue&mode=3v3&game=hoops       public matchmaking (game: soccar | hoops | dropshot)
//   /ws?op=create&mode=2v2&game=..&arena=..&fill=off|pro..  create a private match (join code returned in welcome)
//   /ws?op=join&code=ABC234                join a private match, or reconnect (token in hello)

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { attachWebSocket } from './ws.js';
import { MatchHost } from '../shared/host.js';
import { PHYSICS, NET, MODES, GAME_MODES, ARENA_VARIANTS, arenasForMode } from '../shared/config.js';
import { validateClientMsg, CODE_RE, makeCode } from '../shared/protocol.js';
import { setLogSink, log } from '../shared/log.js';
import { Matchmaker } from './matchmaking.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const a = { port: +(process.env.PORT || 8080), host: '0.0.0.0', lag: 0, jitter: 0, loss: 0, snapshotRate: NET.snapshotRate, quiet: false, lobbyTimeout: 25 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--port') { a.port = +v; i++; }
    else if (k === '--host') { a.host = v; i++; }
    else if (k === '--lag') { a.lag = +v; i++; }
    else if (k === '--jitter') { a.jitter = +v; i++; }
    else if (k === '--loss') { a.loss = +v; i++; }
    else if (k === '--snapshot-rate') { a.snapshotRate = +v; i++; }
    else if (k === '--lobby-timeout') { a.lobbyTimeout = +v; i++; }
    else if (k === '--quiet') a.quiet = true;
  }
  return a;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

export function startServer(opts = {}) {
  const cfg = { ...parseArgs([]), ...opts };
  const sessions = new Map(); // code -> session record
  const stats = { connections: 0, ticks: 0, tickMs: 0, maxTickMs: 0, msgsIn: 0, msgsOut: 0, rejected: 0 };
  let connSeq = 0;

  setLogSink((e) => { if (!cfg.quiet) process.stdout.write(JSON.stringify(e) + '\n'); });

  // ------------------------------------------------------------- sessions
  function createSession({ mode, game, isPrivate, fill, arena }) {
    let code;
    do code = makeCode(); while (sessions.has(code));
    const rec = { code, conns: new Map(), joining: null, host: null, created: Date.now() };
    rec.host = new MatchHost({
      mode, game, isPrivate, fill, arena, code, kind: 'dedicated', snapshotRate: cfg.snapshotRate, lobbyTimeout: cfg.lobbyTimeout,
      out: (target, msg) => route(rec, target, msg),
      onEmpty: () => { sessions.delete(code); for (const c of rec.conns.values()) c.ws.close(1000, 'session closed'); },
    });
    sessions.set(code, rec);
    log('server', 'session created', { code, mode, game: rec.host.game, arena: rec.host.arena, isPrivate });
    return rec;
  }

  // queue key: "<game>:<size>", e.g. "hoops:2v2"
  const matchmaker = new Matchmaker({
    findOpen: (key) => {
      const [game, mode] = key.split(':');
      return [...sessions.values()].find((s) => !s.host.isPrivate && s.host.mode === mode && s.host.game === game && s.host.phase !== 'closed' && s.host.phase !== 'results' &&
        (s.host.phase === 'lobby' ? s.host.humans().length < s.host.capacity() : [...s.host.players.values()].some((p) => p.bot)));
    },
    create: (key) => {
      const [game, mode] = key.split(':');
      const maps = arenasForMode(game).filter((id) => ARENA_VARIANTS[id].competitive);
      return createSession({ mode, game, isPrivate: false, fill: 'pro', arena: maps[Math.floor(Math.random() * maps.length)] });
    },
  });

  function route(rec, target, msg) {
    if (target !== null && !rec.conns.has(target) && rec.joining && msg.t === 'welcome') {
      rec.conns.set(target, rec.joining); rec.joining.pid = target;
    }
    let text = null;
    if (target === null) {
      for (const c of rec.conns.values()) { text ??= JSON.stringify(msg); deliver(c, text, msg.t); }
    } else {
      const c = rec.conns.get(target);
      if (c) deliver(c, JSON.stringify(msg), msg.t);
    }
  }

  // ------------------------------------------------------------- network condition simulation
  function delayFor(c) {
    let d = cfg.lag / 2 + (cfg.jitter ? Math.random() * cfg.jitter : 0);
    if (cfg.loss && Math.random() < cfg.loss) d += cfg.lag + 30; // TCP retransmit-like stall
    return d;
  }
  function deliver(c, text, type) {
    stats.msgsOut++;
    if (!cfg.lag && !cfg.jitter && !cfg.loss) return c.ws.send(text);
    const at = Math.max(c.outReady, performance.now() + delayFor(c)); // order preserved, like TCP
    c.outReady = at;
    setTimeout(() => c.ws.open && c.ws.send(text), at - performance.now());
  }
  function inbound(c, fn) {
    if (!cfg.lag && !cfg.jitter && !cfg.loss) return fn();
    const at = Math.max(c.inReady, performance.now() + delayFor(c));
    c.inReady = at;
    setTimeout(fn, at - performance.now());
  }

  // ------------------------------------------------------------- connections
  function onConnection(ws, req, url) {
    stats.connections++;
    const c = { id: ++connSeq, ws, rec: null, pid: 0, op: url.searchParams.get('op') || 'queue', url, msgTimes: [], violations: 0, outReady: 0, inReady: 0, pingAt: 0 };
    log('net', 'connection', { id: c.id, op: c.op, ip: req.socket.remoteAddress });
    ws.on('message', (text, size) => inbound(c, () => onMessage(c, text, size)));
    ws.on('pong', () => { if (c.rec && c.pid) c.rec.host.setPing(c.pid, Math.round(performance.now() - c.pingAt)); });
    ws.on('close', (reason) => {
      log('net', 'disconnect', { id: c.id, pid: c.pid, reason });
      matchmaker.cancel(c);
      if (c.rec && c.pid) { c.rec.conns.delete(c.pid); c.rec.host.disconnect(c.pid); }
    });
  }

  function reject(c, code, msg) {
    stats.rejected++;
    c.ws.send(JSON.stringify({ t: 'error', code, msg }));
    c.ws.close(4000, code);
  }

  function onMessage(c, text, size) {
    stats.msgsIn++;
    const now = performance.now();
    c.msgTimes.push(now);
    while (c.msgTimes.length && now - c.msgTimes[0] > 1000) c.msgTimes.shift();
    if (c.msgTimes.length > NET.maxMsgsPerSec) { if (++c.violations > 100) reject(c, 'rate_limited', 'Too many messages.'); return; }
    if (size > NET.maxMsgBytes) return reject(c, 'too_big', 'Message too large.');
    let m;
    try { m = JSON.parse(text); } catch { if (++c.violations > 50) reject(c, 'bad_packets', 'Malformed data.'); return; }
    if (!c.rec) {
      const hello = validateClientMsg(m);
      if (!hello || hello.t !== 'hello') return reject(c, 'expected_hello', 'Handshake required.');
      return joinFor(c, hello);
    }
    const r = c.rec.host.handle(c.pid, m);
    if (r === 'invalid' && ++c.violations > 50) { log('net', 'too many invalid messages; disconnecting', { pid: c.pid }); reject(c, 'bad_packets', 'Invalid messages.'); }
  }

  function joinFor(c, hello) {
    const op = c.op, mode = MODES[c.url.searchParams.get('mode')] ? c.url.searchParams.get('mode') : '3v3';
    const game = GAME_MODES[c.url.searchParams.get('game')] ? c.url.searchParams.get('game') : 'soccar';
    let rec;
    if (op === 'join') {
      const code = (c.url.searchParams.get('code') || '').toUpperCase();
      if (!CODE_RE.test(code) || !sessions.has(code)) return reject(c, 'bad_code', 'No match with that code.');
      rec = sessions.get(code);
    } else if (op === 'create') {
      const fill = c.url.searchParams.get('fill');
      rec = createSession({ mode, game, isPrivate: true, fill: ['off', 'rookie', 'pro', 'elite'].includes(fill) ? fill : 'off', arena: c.url.searchParams.get('arena') || '' });
    } else if (op === 'queue') {
      c.ws.send(JSON.stringify({ t: 'queue', status: 'searching', mode, game }));
      rec = matchmaker.place(c, game + ':' + mode);
    } else return reject(c, 'bad_op', 'Unknown operation.');
    rec.joining = c;
    const res = rec.host.join(hello.name, hello.cos, hello.token);
    rec.joining = null;
    if (res.error) return reject(c, res.error, res.error === 'full' ? 'That match is full.' : 'That match has ended.');
    c.rec = rec; c.pid = res.pid;
    rec.conns.set(res.pid, c);
  }

  // ------------------------------------------------------------- http
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/status') {
        const body = {
          ok: true, sessions: sessions.size, players: [...sessions.values()].reduce((a, s) => a + s.host.connectedHumans().length, 0),
          tickRate: PHYSICS.tickRate, snapshotRate: cfg.snapshotRate, avgTickMs: stats.ticks ? +(stats.tickMs / stats.ticks).toFixed(3) : 0,
          maxTickMs: +stats.maxTickMs.toFixed(3), lag: cfg.lag, jitter: cfg.jitter, loss: cfg.loss,
          list: [...sessions.values()].map((s) => ({ code: s.host.isPrivate ? 'private' : s.code, mode: s.host.mode, game: s.host.game, arena: s.host.arena, phase: s.host.phase, humans: s.host.connectedHumans().length })),
        };
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        return res.end(JSON.stringify(body));
      }
      let p = decodeURIComponent(url.pathname);
      if (p === '/' || p === '/index.html') p = '/client/index.html';
      const file = path.resolve(ROOT, '.' + p);
      const allowed = ['client', 'shared', 'vendor'].some((d) => file.startsWith(path.join(ROOT, d) + path.sep));
      if (!allowed) { res.writeHead(404); return res.end('not found'); }
      const st = await stat(file).catch(() => null);
      if (!st || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(await readFile(file));
    } catch (e) {
      log('server', 'http error', { err: String(e) });
      res.writeHead(500); res.end('error');
    }
  });
  attachWebSocket(server, { path: '/ws', maxPayload: NET.maxMsgBytes * 2, onConnection });

  // ------------------------------------------------------------- fixed-step loop
  let last = performance.now(), acc = 0, pingT = 0, running = true;
  function loop() {
    if (!running) return;
    const now = performance.now();
    acc += Math.min(now - last, 250) / 1000;
    last = now;
    while (acc >= PHYSICS.dt) {
      acc -= PHYSICS.dt;
      const t0 = performance.now();
      for (const rec of sessions.values()) {
        try { rec.host.tick(); } catch (e) { log('server', 'session tick failed; closing session', { code: rec.code, err: String(e.stack || e) }); rec.host.close('error'); }
      }
      const ms = performance.now() - t0;
      stats.ticks++; stats.tickMs += ms; stats.maxTickMs = Math.max(stats.maxTickMs, ms);
    }
    matchmaker.update();
    if (now - pingT > 2000) {
      pingT = now;
      for (const rec of sessions.values()) for (const c of rec.conns.values()) { c.pingAt = performance.now(); c.ws.ping(); }
    }
    // sleep until the next tick is due (keeps CPU low on small instances)
    const wait = Math.max(0, (PHYSICS.dt - acc) * 1000 - 1);
    setTimeout(loop, sessions.size ? Math.min(wait, 8) : 20);
  }
  loop();

  return new Promise((resolve) => {
    server.listen(cfg.port, cfg.host, () => {
      const port = server.address().port;
      log('server', 'listening', { port, lag: cfg.lag, jitter: cfg.jitter, loss: cfg.loss });
      resolve({
        port, sessions, stats, server,
        close: () => new Promise((r) => { running = false; for (const s of sessions.values()) for (const c of s.conns.values()) c.ws.terminate('shutdown'); server.close(() => r()); setTimeout(r, 500); }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer(parseArgs(process.argv.slice(2)));
}
