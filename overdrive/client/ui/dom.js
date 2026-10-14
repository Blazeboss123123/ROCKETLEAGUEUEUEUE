// Tiny DOM helpers. All user-provided text goes through textContent (never innerHTML).
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

let toastRoot = null;
export function toast(msg, kind = '', ms = 3200) {
  if (!toastRoot) { toastRoot = h('div', { class: 'toasts' }); document.querySelector('.ui-layer').appendChild(toastRoot); }
  const t = h('div', { class: 'toast ' + kind }, msg);
  toastRoot.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  const render = (v) => {
    clear(el);
    for (const o of options) {
      const [val, label] = Array.isArray(o) ? o : [o, o];
      el.appendChild(h('button', { class: val === v ? 'on' : '', role: 'radio', 'aria-checked': String(val === v), onclick: () => { render(val); onChange(val); } }, label));
    }
  };
  render(value);
  return el;
}

export function toggle(value, onChange) {
  const b = h('button', { class: 'toggle' + (value ? ' on' : ''), role: 'switch', 'aria-checked': String(!!value) });
  b.addEventListener('click', () => { value = !value; b.classList.toggle('on', value); b.setAttribute('aria-checked', String(value)); onChange(value); });
  return b;
}

export function fmtClock(sec, overtime) {
  const s = Math.max(0, overtime ? Math.floor(sec) : Math.ceil(sec));
  const m = Math.floor(s / 60), r = s % 60;
  return (overtime ? '+' : '') + m + ':' + String(r).padStart(2, '0');
}

export function fmtDuration(sec) {
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60);
  return hh ? `${hh}h ${mm}m` : `${mm}m ${Math.floor(sec % 60)}s`;
}

export function bannerStyle(id, color = '#2f7dff') {
  const map = {
    grid: `repeating-linear-gradient(0deg, transparent 0 14px, rgba(255,255,255,0.08) 14px 15px), repeating-linear-gradient(90deg, transparent 0 14px, rgba(255,255,255,0.08) 14px 15px), linear-gradient(120deg, ${color}, #0b1020)`,
    waves: `radial-gradient(circle at 20% 120%, transparent 30%, rgba(255,255,255,0.12) 31%, transparent 33%), radial-gradient(circle at 60% 130%, transparent 40%, rgba(255,255,255,0.1) 41%, transparent 43%), linear-gradient(120deg, #0ea5e9, #312e81)`,
    chevron: `repeating-linear-gradient(135deg, transparent 0 12px, rgba(0,0,0,0.25) 12px 24px), linear-gradient(90deg, ${color}, #f97316)`,
    sunset: `linear-gradient(180deg, #f97316 0%, #db2777 55%, #4c1d95 100%)`,
    circuit: `repeating-linear-gradient(90deg, transparent 0 22px, rgba(94,225,255,0.35) 22px 23px), repeating-linear-gradient(0deg, transparent 0 18px, rgba(94,225,255,0.2) 18px 19px), linear-gradient(120deg, #052e2b, #0b1020)`,
  };
  return map[id] || map.grid;
}
