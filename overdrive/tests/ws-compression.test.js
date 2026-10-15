import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import zlib from 'node:zlib';
import { startServer } from '../server/server.js';

// Browsers compress client messages with permessage-deflate (sync flush, trailing 00 00 ff ff
// removed). The server must decode those and compress its own replies the same way.
test('permessage-deflate: browser-style compressed frames in both directions', async () => {
  const srv = await startServer({ port: 0, quiet: true });
  try {
    const sock = net.connect(srv.port, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    sock.write('GET /ws?op=queue&mode=1v1&game=soccar HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n\r\n');
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
    const until = async (fn, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); } throw new Error('timeout'); };
    await until(() => buf.includes('\r\n\r\n'));
    const head = buf.subarray(0, buf.indexOf('\r\n\r\n')).toString();
    assert.match(head, /101 Switching Protocols/);
    assert.match(head, /permessage-deflate/);
    buf = buf.subarray(buf.indexOf('\r\n\r\n') + 4);
    // client frame: compressed, masked, RSV1 set
    const z = zlib.deflateRawSync(Buffer.from(JSON.stringify({ t: 'hello', v: 5, name: 'Zip', cos: {} })), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
    const body = z.subarray(0, z.length - 4);
    const mask = Buffer.from([1, 2, 3, 4]);
    const masked = Buffer.from(body.map((b, i) => b ^ mask[i & 3]));
    sock.write(Buffer.concat([Buffer.from([0xc1, 0x80 | body.length]), mask, masked]));
    // read server frames until a welcome arrives; compressed ones have RSV1 set
    const msgs = [];
    let sawCompressed = false;
    await until(() => {
      while (buf.length >= 2) {
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); off = 4; }
        if (buf.length < off + len) break;
        let payload = buf.subarray(off, off + len);
        if (buf[0] & 0x40) { sawCompressed = true; payload = zlib.inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])]), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
        if ((buf[0] & 0x0f) === 1) msgs.push(JSON.parse(payload.toString()));
        buf = buf.subarray(off + len);
      }
      return msgs.some((m) => m.t === 'welcome');
    });
    assert.ok(msgs.some((m) => m.t === 'welcome'), 'server understood the compressed hello');
    assert.ok(sawCompressed, 'server compresses larger messages');
    sock.destroy();
  } finally { await srv.close(); }
});
