// Structured logging. Categories: physics, net, match, persist, ui, server.
// Each entry is {t, cat, msg, data}. Sinks can be replaced (server writes JSON lines).

const ring = [];
let sink = null;
let quiet = false;

export function setLogSink(fn) { sink = fn; }
export function setQuiet(q) { quiet = q; }
export function recentLogs() { return ring.slice(); }

export function log(cat, msg, data) {
  const e = { t: Date.now(), cat, msg, data };
  ring.push(e);
  if (ring.length > 200) ring.shift();
  if (sink) sink(e);
  else if (!quiet && typeof console !== 'undefined') console.warn(`[${cat}] ${msg}`, data ?? '');
}
