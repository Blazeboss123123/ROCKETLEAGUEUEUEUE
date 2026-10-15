// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation) with
// permessage-deflate (RFC 7692, no context takeover), written from scratch so the dedicated
// server has zero third-party dependencies.

import { createHash } from 'node:crypto';
import zlib from 'node:zlib';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const TAIL = Buffer.from([0x00, 0x00, 0xff, 0xff]);
const MIN_DEFLATE = 160; // smaller messages are sent as-is

function frameHeader(op, len, rsv1) {
  const b0 = 0x80 | (rsv1 ? 0x40 : 0) | op;
  if (len < 126) return Buffer.from([b0, len]);
  if (len < 65536) { const h = Buffer.alloc(4); h[0] = b0; h[1] = 126; h.writeUInt16BE(len, 2); return h; }
  const h = Buffer.alloc(10); h[0] = b0; h[1] = 127; h.writeUInt32BE(0, 2); h.writeUInt32BE(len, 6); return h;
}

// A text message encoded once and sendable to many sockets (broadcast snapshots), in both the
// plain and the compressed form; each form is built lazily the first time a socket needs it.
export class Prepared {
  constructor(text) { this.data = Buffer.from(text, 'utf8'); this.plain = null; this.deflated = null; }
  frame(deflate) {
    if (deflate && this.data.length >= MIN_DEFLATE) {
      if (!this.deflated) {
        const z = zlib.deflateRawSync(this.data, { level: 6, finishFlush: zlib.constants.Z_SYNC_FLUSH });
        const body = z.subarray(z.length - 4).equals(TAIL) ? z.subarray(0, z.length - 4) : z;
        this.deflated = Buffer.concat([frameHeader(0x1, body.length, true), body]);
      }
      return this.deflated;
    }
    if (!this.plain) this.plain = Buffer.concat([frameHeader(0x1, this.data.length, false), this.data]);
    return this.plain;
  }
}

export class WSConn extends EventEmitter {
  constructor(socket, req, maxPayload, deflate = false) {
    super();
    this.deflate = deflate;
    this.compressedMsg = false;
    this.socket = socket;
    this.req = req;
    this.maxPayload = maxPayload;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.open = true;
    this.bytesIn = 0; this.bytesOut = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('close', () => this.terminate('socket-closed'));
    socket.on('error', () => this.terminate('socket-error'));
  }

  onData(d) {
    this.bytesIn += d.length;
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    while (this.open) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = (b[0] & 0x80) !== 0, rsv1 = (b[0] & 0x40) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
      if ((b[0] & 0x30) || (rsv1 && (!this.deflate || op === 0x0 || op >= 0x8))) return this.fail(1002, 'bad reserved bits');
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (b.length < 10) return;
        const hi = b.readUInt32BE(2), lo = b.readUInt32BE(6);
        if (hi !== 0) return this.fail(1009, 'too big');
        len = lo; off = 10;
      }
      if (!masked) return this.fail(1002, 'client frames must be masked');
      if (len > this.maxPayload) return this.fail(1009, 'message too big');
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4);
      const payload = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      if (rsv1) this.compressedMsg = true;
      this.onFrame(fin, op, payload);
    }
  }

  onFrame(fin, op, payload) {
    if (op === 0x8) { this.sendFrame(0x8, payload.subarray(0, 2)); return this.terminate('closed'); }
    if (op === 0x9) return this.sendFrame(0xa, payload);
    if (op === 0xa) { this.emit('pong'); return; }
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.frags.push(payload);
      const total = this.frags.reduce((a, f) => a + f.length, 0);
      if (total > this.maxPayload) return this.fail(1009, 'message too big');
      if (!fin) return;
      let raw = Buffer.concat(this.frags);
      this.frags = [];
      if (this.compressedMsg) {
        this.compressedMsg = false;
        try { raw = zlib.inflateRawSync(Buffer.concat([raw, TAIL]), { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: this.maxPayload }); } catch { return this.fail(1009, 'bad or oversized compressed message'); }
      }
      this.emit('message', raw.toString('utf8'), raw.length);
      return;
    }
    this.fail(1002, 'bad opcode');
  }

  sendFrame(op, data) {
    if (!this.open) return;
    this.writeRaw(Buffer.concat([frameHeader(op, data.length, false), data]));
  }
  writeRaw(buf) {
    if (!this.open || this.socket.destroyed || !this.socket.writable) return;
    this.bytesOut += buf.length;
    this.socket.write(buf);
  }

  send(text) { this.sendPrepared(text instanceof Prepared ? text : new Prepared(text)); }
  sendPrepared(p) { this.writeRaw(p.frame(this.deflate)); }
  ping() { this.sendFrame(0x9, Buffer.alloc(0)); }

  fail(code, reason) {
    const b = Buffer.alloc(2 + Buffer.byteLength(reason));
    b.writeUInt16BE(code, 0); b.write(reason, 2);
    this.sendFrame(0x8, b);
    this.terminate(reason);
  }
  close(code = 1000, reason = '') { this.fail(code, reason); }

  terminate(reason) {
    if (!this.open) return;
    this.open = false;
    try { this.socket.end(); } catch { /* ignore */ }
    setTimeout(() => { try { this.socket.destroy(); } catch { /* ignore */ } }, 500);
    this.emit('close', reason);
  }
}

// Attach to a node http server. onConnection(conn, req, url)
export function attachWebSocket(httpServer, { path = '/ws', maxPayload = 16384, onConnection, deflate: deflateEnabled = true }) {
  httpServer.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    // compression: accept permessage-deflate when offered, without context takeover (every message is
    // compressed on its own, so a broadcast is compressed once for all players)
    const deflate = deflateEnabled && /permessage-deflate/i.test(req.headers['sec-websocket-extensions'] || '');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n` +
      (deflate ? 'Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover\r\n' : '') + '\r\n');
    const conn = new WSConn(socket, req, maxPayload, deflate);
    onConnection(conn, req, url);
  });
}
