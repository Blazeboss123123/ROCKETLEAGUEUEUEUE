// Helpers for multiplayer tests: headless clients connected to a real server.
import { ClientSession } from '../shared/client.js';
import { wsConnect } from '../shared/wsconn.js';
import { neutralInput } from '../shared/car.js';

export function connectClient(port, query, name = 'Tester', token = null) {
  const conn = wsConnect(`ws://127.0.0.1:${port}/ws?${query}`);
  const s = new ClientSession({ conn, name, cos: { body: 'comet' }, token });
  conn.attach(s);
  s.input = neutralInput();
  return s;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, ms = 5000, step = 10) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(step); }
  throw new Error('timeout waiting for condition: ' + fn.toString().slice(0, 120));
}

// Drive a set of clients in real time for `ms` milliseconds.
export async function run(clients, ms, perFrame) {
  const t0 = performance.now(); let last = t0;
  while (performance.now() - t0 < ms) {
    await sleep(8);
    const now = performance.now(); const dt = (now - last) / 1000; last = now;
    for (const c of clients) { perFrame?.(c); c.update(dt, c.input); }
  }
}
