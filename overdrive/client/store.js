// Persistent key-value store (localStorage) with an in-memory fallback.
// Failures are logged (persistence category) and never crash the game.
import { log } from '../shared/log.js';

const PREFIX = 'overdrive.';
const mem = new Map();
let ok = true;
try { const k = PREFIX + '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); } catch { ok = false; }

export const store = {
  persistent: ok,
  get(key, fallback) {
    try {
      const raw = ok ? localStorage.getItem(PREFIX + key) : mem.get(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { log('persist', 'failed to read ' + key, String(e)); return fallback; }
  },
  set(key, value) {
    const raw = JSON.stringify(value);
    try { if (ok) localStorage.setItem(PREFIX + key, raw); else mem.set(key, raw); }
    catch (e) { log('persist', 'failed to save ' + key, String(e)); mem.set(key, raw); }
  },
  remove(key) { try { if (ok) localStorage.removeItem(PREFIX + key); mem.delete(key); } catch { /* ignore */ } },
};
