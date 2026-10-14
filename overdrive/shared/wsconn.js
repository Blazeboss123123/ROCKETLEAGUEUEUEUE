// WebSocket connection adapter for ClientSession (browser and Node 22+ global WebSocket).
export function wsConnect(url, { onOpen, onClose } = {}) {
  const ws = new WebSocket(url);
  const queue = [];
  let target = null;
  const conn = {
    ws,
    send(m) {
      const s = JSON.stringify(m);
      if (ws.readyState === 1) ws.send(s); else if (ws.readyState === 0) queue.push(s);
    },
    close() { try { ws.close(); } catch { /* ignore */ } },
    attach(session) { target = session; },
  };
  ws.onopen = () => { for (const s of queue.splice(0)) ws.send(s); onOpen?.(); };
  ws.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    target?.receive(m);
  };
  ws.onclose = (e) => {
    target?.receive({ t: 'closed', reason: e.reason || 'connection_lost', transport: true });
    onClose?.(e);
  };
  ws.onerror = () => {};
  return conn;
}
