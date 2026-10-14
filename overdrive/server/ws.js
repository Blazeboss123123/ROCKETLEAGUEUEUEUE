// Minimal RFC 6455 WebSocket server (text frames, ping/pong, close, fragmentation),
// written from scratch so the dedicated server has zero third-party dependencies.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WSConn extends EventEmitter {
  constructor(socket, req, maxPayload) {
    super();
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
      const fin = (b[0] & 0x80) !== 0, op = b[0] & 0x0f, masked = (b[1] & 0x80) !== 0;
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
      const msg = Buffer.concat(this.frags).toString('utf8');
      this.frags = [];
      this.emit('message', msg, total);
      return;
    }
    this.fail(1002, 'bad opcode');
  }

  sendFrame(op, data) {
    if (!this.open) return;
    const len = data.length;
    let header;
    if (len < 126) { header = Buffer.from([0x80 | op, len]); }
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | op; header[1] = 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | op; header[1] = 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(len, 6); }
    this.bytesOut += header.length + len;
    this.socket.write(Buffer.concat([header, data]));
  }

  send(text) { this.sendFrame(0x1, Buffer.from(text, 'utf8')); }
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
export function attachWebSocket(httpServer, { path = '/ws', maxPayload = 16384, onConnection }) {
  httpServer.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new WSConn(socket, req, maxPayload);
    onConnection(conn, req, url);
  });
}
