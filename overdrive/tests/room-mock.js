// In-memory model of the artifact `room` capability for testing the browser-host transport:
// presence is latest-value-wins, coalesced at ~30 Hz, delivered with latency/jitter, and
// frames may be dropped (the latest value still arrives on a later frame).

export class MockHub {
  constructor({ latency = 40, jitter = 20, drop = 0, rate = 30 } = {}) {
    Object.assign(this, { latency, jitter, drop });
    this.channels = new Map(); // name -> Map(peerId -> member)
    this.nextPeer = 1;
    this.timer = setInterval(() => this.flush(), 1000 / rate);
  }
  stop() { clearInterval(this.timer); }
  channel(name) { if (!this.channels.has(name)) this.channels.set(name, new Map()); return this.channels.get(name); }

  page() {
    const hub = this;
    const peerId = 'p' + String(hub.nextPeer++).padStart(4, '0');
    const makeRoom = (name) => {
      const ch = hub.channel(name);
      const me = { peer: peerId, presence: Object.freeze({}), dirty: false, view: new Map(), handlers: new Set(), lastSent: new Map() };
      ch.set(peerId, me);
      const snapshot = () => [...me.view.values()];
      const self = () => ({ peer: peerId, by: null, isMe: true, sameTab: true, kind: 'viewer', guest: false, presence: me.presence, updatedAt: Date.now() });
      me.view.set(peerId, Object.freeze(self()));
      const emitChange = (change) => { for (const h of me.handlers) h({ peers: snapshot(), ...change }); };
      me.emit = emitChange;
      // existing members appear, and everyone else learns about us
      setTimeout(() => {
        const joined = [];
        for (const [pid, m] of ch) if (pid !== peerId) { const p = Object.freeze({ peer: pid, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: m.presence, updatedAt: Date.now() }); me.view.set(pid, p); joined.push(p); }
        emitChange({ joined: [me.view.get(peerId), ...joined], left: [], updated: [] });
        for (const [pid, m] of ch) if (pid !== peerId) { const p = Object.freeze({ peer: peerId, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: me.presence, updatedAt: Date.now() }); m.view.set(peerId, p); m.emit({ joined: [p], left: [], updated: [] }); }
      }, hub.latency);
      return {
        async presence(patch) {
          const next = { ...me.presence };
          for (const [k, v] of Object.entries(structuredClone(patch))) { if (v === null) delete next[k]; else next[k] = v; }
          const size = JSON.stringify(next).length;
          if (size > 4096) { const e = new Error('presence too large: ' + size); e.code = 'invalid_argument'; throw e; }
          me.presence = Object.freeze(next);
          me.view.set(peerId, Object.freeze({ ...me.view.get(peerId), presence: me.presence }));
          me.dirty = true;
        },
        onPeers(h) { me.handlers.add(h); setTimeout(() => h({ peers: snapshot(), joined: snapshot(), left: [], updated: [] }), 0); return () => me.handlers.delete(h); },
        peers: snapshot,
        async join(sub) { return makeRoom(name + '/' + sub); },
        leave() {
          ch.delete(peerId);
          for (const m of ch.values()) { const p = m.view.get(peerId); if (p) { m.view.delete(peerId); m.emit({ joined: [], left: [p], updated: [] }); } }
        },
        _member: me,
      };
    };
    return makeRoom('lobby');
  }

  flush() {
    const now = Date.now();
    for (const ch of this.channels.values()) {
      for (const [pid, m] of ch) {
        if (!m.dirty) continue;
        if (this.drop && Math.random() < this.drop) continue; // try again next frame
        m.dirty = false;
        const pres = m.presence;
        for (const [qid, q] of ch) {
          if (qid === pid) continue;
          const at = Math.max(q.lastSent.get(pid) || 0, now + this.latency + Math.random() * this.jitter);
          q.lastSent.set(pid, at);
          setTimeout(() => {
            if (!ch.has(qid) || !ch.has(pid)) return;
            const p = Object.freeze({ peer: pid, by: null, isMe: false, sameTab: false, kind: 'viewer', guest: false, presence: pres, updatedAt: Date.now() });
            q.view.set(pid, p);
            q.emit({ joined: [], left: [], updated: [p] });
          }, at - now);
        }
      }
    }
  }
}
