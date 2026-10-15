// Garage / customisation: rotating, orbitable preview with team-colour toggle, item panels,
// confirm and reset. Cosmetics are visual only and never change the gameplay hitbox.
import { h, clear, seg, toast, bannerStyle } from './dom.js';
import { CATALOG, PAINTS, SLOT_LABELS, DEFAULT_LOADOUT } from '../cosmetics.js';

const TABS = [
  ['body', 'Body', ['body']], ['paint', 'Paint', ['paint', 'accent', 'finish']], ['wheels', 'Wheels', ['wheels', 'wheelColor']],
  ['trail', 'Boost Trail', ['trail']], ['goal', 'Goal Explosion', ['goal']], ['engine', 'Engine Audio', ['engine']],
  ['antenna', 'Antenna', ['antenna']], ['decal', 'Decal', ['decal']], ['topper', 'Topper', ['topper']], ['glow', 'Underglow', ['glow']],
  ['banner', 'Banner & Title', ['banner', 'title']], ['horn', 'Goal Celebration', ['horn']],
];

export function garageScreen(app, params = {}) {
  const prof = app.profile;
  const draft = { ...prof.loadout };
  let tab = params.tab || 'body';
  let team = 0;
  const view = app.renderer.showroom;
  view.yaw = 0.6; view.pitch = 0.18; view.zoom = 1; view.auto = true;
  const refreshCar = () => app.renderer.setShowroomCar(draft, team);
  refreshCar();

  const cats = h('div', { class: 'cats panel' });
  const items = h('div', { class: 'panel', style: { overflow: 'auto' } });
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(prof.loadout);

  const pick = (slot, id) => {
    if (!prof.isUnlocked(slot, id)) { const it = CATALOG[slot].find((x) => x.id === id); toast(`Unlocks at level ${it.lvl} — play matches to earn XP.`, 'err'); return; }
    draft[slot] = id; app.audio.play('click');
    if (slot === 'engine') previewEngine(app, id);
    if (slot === 'horn') app.audio.goalSound(id);
    if (slot === 'goal') app.renderer.showroomBurst(id, team);
    refreshCar(); renderItems();
  };

  const renderCats = () => {
    clear(cats);
    for (const [id, label, slots] of TABS) {
      const cur = slots.map((s) => (s === 'paint' || s === 'accent' ? null : (CATALOG[s].find((x) => x.id === draft[s])?.name))).filter(Boolean).join(' · ');
      cats.appendChild(h('button', { class: 'cat' + (id === tab ? ' on' : ''), onclick: () => { tab = id; renderCats(); renderItems(); } }, label, h('small', null, cur || 'Colours')));
    }
  };
  const renderItems = () => {
    clear(items);
    const slots = TABS.find((t) => t[0] === tab)[2];
    for (const slot of slots) {
      items.appendChild(h('h3', { style: { marginTop: '6px' } }, SLOT_LABELS[slot]));
      if (slot === 'paint' || slot === 'accent') {
        items.appendChild(h('div', { class: 'swatches', style: { marginBottom: '14px' } }, PAINTS.map((c) => h('button', {
          class: 'sw' + (draft[slot] === c ? ' on' : ''), style: { background: '#' + c.toString(16).padStart(6, '0') }, 'aria-label': 'Colour #' + c.toString(16).padStart(6, '0'),
          onclick: () => { draft[slot] = c; refreshCar(); renderItems(); },
        }))));
        continue;
      }
      items.appendChild(h('div', { class: 'items', style: { marginBottom: '14px', maxHeight: 'none' } }, CATALOG[slot].map((it) => {
        const locked = !prof.isUnlocked(slot, it.id);
        return h('button', { class: 'item' + (draft[slot] === it.id ? ' on' : '') + (locked ? ' locked' : ''), onclick: () => pick(slot, it.id), 'aria-pressed': String(draft[slot] === it.id) },
          slot === 'banner' ? h('div', { style: { height: '26px', background: bannerStyle(it.id), marginBottom: '4px' } }) : null,
          h('span', { class: 'n' }, it.name), h('span', { class: 'd' }, locked ? `🔒 Level ${it.lvl}` : it.desc || (slot === 'body' ? '' : '')));
      })));
    }
    if (tab === 'body') items.appendChild(h('p', { class: 'small muted' }, 'All bodies share one identical gameplay hitbox, mass and handling. Choose purely on looks.'));
  };
  renderCats(); renderItems();

  // drag-to-orbit stage
  const stage = h('div', { class: 'garage-stage', style: { pointerEvents: 'auto', cursor: 'grab' } },
    h('div', { class: 'hint' }, 'Drag to orbit · scroll to zoom'),
    h('div', { class: 'row', style: { marginBottom: '6px' } },
      seg([[0, 'Blue preview'], [1, 'Orange preview']], team, (v) => { team = v; refreshCar(); }),
      h('button', { class: 'btn sm', onclick: () => { Object.assign(draft, DEFAULT_LOADOUT); refreshCar(); renderCats(); renderItems(); toast('Reset to default look — confirm to save'); } }, 'Reset to default'),
      h('button', { class: 'btn primary', onclick: () => { Object.assign(prof.loadout, draft); prof.validateLoadout(); prof.save(); toast('Loadout saved', 'ok'); renderCats(); } }, 'Confirm')));
  let drag = null;
  stage.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; drag = { x: e.clientX, y: e.clientY }; view.auto = false; stage.setPointerCapture(e.pointerId); stage.style.cursor = 'grabbing'; });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const k = 0.008 * app.settings.mouseSensitivity;
    view.yaw -= (e.clientX - drag.x) * k; view.pitch = Math.max(-0.1, Math.min(1.2, view.pitch + (e.clientY - drag.y) * k));
    drag = { x: e.clientX, y: e.clientY };
  });
  const end = () => { drag = null; stage.style.cursor = 'grab'; };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); view.zoom = Math.max(0.6, Math.min(1.8, view.zoom * (e.deltaY > 0 ? 1.08 : 0.93))); }, { passive: false });

  const el = h('div', { class: 'screen', style: { padding: 0 } },
    h('div', { class: 'topbar', style: { padding: '22px 28px 0', marginBottom: 0 } },
      h('button', { class: 'btn ghost', onclick: () => { if (dirty()) app.confirm('Discard changes?', 'You have unsaved customisation changes.', () => { app.go('main'); }); else app.go('main'); } }, '← Back'),
      h('h1', null, params.tab && params.tab !== 'body' ? 'Customise' : 'Garage'), h('div', { class: 'spacer' }),
      h('div', { class: 'crumb' }, `Everything unlocked · ${Object.values(CATALOG).reduce((n, l) => n + l.length, 0)} items`)),
    h('div', { class: 'garage' }, cats, stage, items));
  return { el, leave() { app.renderer.setShowroomCar(prof.loadout, 0); } };
}

function previewEngine(app, profile) {
  const a = app.audio;
  if (!a.ctx) return;
  let t = 0;
  const id = 'preview';
  const iv = setInterval(() => {
    t += 0.05;
    const speed = t < 1 ? t * 23 : Math.max(0, 23 - (t - 1) * 30);
    a.engine(id, profile, null, speed, t < 1 ? 1 : 0, false, true);
    if (t > 1.8) { clearInterval(iv); a.stopEngine(id); }
  }, 50);
}
