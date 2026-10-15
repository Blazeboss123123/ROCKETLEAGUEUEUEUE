// Network protocol: message shapes and strict validation of everything a client sends.
// Clients only ever send intentions (inputs, ready, team choice, pings). They never send
// positions, boost amounts, scores or goals — those exist only on the authority.
//
// Client -> authority
//   {t:'hello', name, cos, token?, v}        join / reconnect (handled by the transport)
//   {t:'in', s:firstSeq, i:[[thr,str,pit,yaw,rol,btn], ...]}   recent inputs (redundant)
//   {t:'ready', v:bool}   {t:'team', v:0|1}   {t:'start'}   {t:'fill', v:'off'|'rookie'|'pro'|'elite'}
//   {t:'ping', c:clientMs}   {t:'chat', q:index}   {t:'rematch'}   {t:'leave'}
// Authority -> client
//   {t:'welcome', pid, token, code, mode, kind, priv}
//   {t:'lobby', ...}   {t:'start', mid, seed, mode, duration, roster}
//   {t:'snap', s:snapshot, a:{pid:ackSeq}}   {t:'stats', mid, stats, ping, roster}
//   {t:'end', mid, score, winner, stats}   {t:'pong', c, s}   {t:'chat', pid, q}
//   {t:'closed', reason}   {t:'error', code, msg}

export const PROTOCOL_VERSION = 5;

export const QUICK_CHAT = [
  'Nice shot!', 'Great pass!', 'What a save!', 'I got it!', 'Need boost!', 'Take the shot!',
  'Defending...', 'Centering!', 'Thanks!', 'Sorry!', 'Good game!', 'Well played.',
];

const NAME_RE = /[^\p{L}\p{N} _\-.]/gu;
export function cleanName(n) {
  if (typeof n !== 'string') return 'Player';
  const s = n.replace(NAME_RE, '').trim().slice(0, 16);
  return s || 'Player';
}

function isInt(v, lo, hi) { return Number.isInteger(v) && v >= lo && v <= hi; }

export function validInputArray(a) {
  return Array.isArray(a) && a.length === 6 &&
    isInt(a[0], -100, 100) && isInt(a[1], -100, 100) && isInt(a[2], -100, 100) &&
    isInt(a[3], -100, 100) && isInt(a[4], -100, 100) && isInt(a[5], 0, 7);
}

// Returns a normalised message or null if invalid. Never throws.
export function validateClientMsg(m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'in': {
      if (!isInt(m.s, 0, 2 ** 31) || !Array.isArray(m.i) || m.i.length < 1 || m.i.length > 32) return null;
      for (const a of m.i) if (!validInputArray(a)) return null;
      return { t: 'in', s: m.s, i: m.i };
    }
    case 'ready': return { t: 'ready', v: !!m.v };
    case 'team': return m.v === 0 || m.v === 1 ? { t: 'team', v: m.v } : null;
    case 'start': return { t: 'start' };
    case 'fill': return ['off', 'rookie', 'pro', 'elite'].includes(m.v) ? { t: 'fill', v: m.v } : null;
    case 'ping': return Number.isFinite(m.c) ? { t: 'ping', c: m.c } : null;
    case 'chat': return isInt(m.q, 0, QUICK_CHAT.length - 1) ? { t: 'chat', q: m.q } : null;
    case 'rematch': return { t: 'rematch' };
    case 'tolobby': return { t: 'tolobby' };
    case 'leave': return { t: 'leave' };
    case 'hello': return {
      t: 'hello', name: cleanName(m.name), cos: sanitizeCosmetics(m.cos),
      token: typeof m.token === 'string' && m.token.length <= 64 ? m.token : null, v: m.v | 0,
    };
    default: return null;
  }
}

// Cosmetics are purely visual; we only keep small, known-shape values.
export function sanitizeCosmetics(c) {
  const out = {};
  if (!c || typeof c !== 'object') return out;
  for (const k of ['body', 'paint', 'finish', 'wheels', 'wheelColor', 'trail', 'goal', 'engine', 'antenna', 'decal', 'topper', 'glow', 'banner', 'title', 'accent', 'horn']) {
    const v = c[k];
    if (typeof v === 'string' && v.length <= 24 && /^[a-z0-9_#-]+$/i.test(v)) out[k] = v;
    else if (Number.isInteger(v) && v >= 0 && v <= 0xffffff) out[k] = v;
  }
  return out;
}

export function makeCode(rand = Math.random) {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous 0/O/1/I
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(rand() * A.length)];
  return s;
}
export const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
