// Settings: video, camera, controls (remapping for keyboard/mouse and controller), audio,
// accessibility and network. Everything applies immediately and persists.
import { h, clear, seg, toggle, toast } from './dom.js';
import { ACTIONS, keyLabel } from '../input.js';
import { DEFAULT_SETTINGS } from '../profile.js';

export function settingsScreen(app, params = {}) {
  const S = app.settings;
  const tabs = [['video', 'Video'], ['camera', 'Camera'], ['controls', 'Controls'], ['touch', 'Tablet'], ['audio', 'Audio'], ['access', 'Accessibility'], ['network', 'Network']];
  let tab = params.tab || 'video';
  const list = h('div', { class: 'setlist panel' });
  const nav = h('div', { class: 'col' });
  const set = (k, v) => { S[k] = v; app.applySettings(k); };

  const row = (label, sub, control) => h('div', { class: 'setrow' }, h('div', { class: 'lbl' }, label, sub ? h('small', null, sub) : null), control);
  const slider = (k, min, max, step, fmt = (v) => v) => {
    const val = h('span', { class: 'val' }, fmt(S[k]));
    const r = h('input', { type: 'range', min, max, step, value: S[k], 'aria-label': k });
    r.addEventListener('input', () => { const v = +r.value; val.textContent = fmt(v); set(k, v); });
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, r, val);
  };
  const tog = (k) => toggle(S[k], (v) => set(k, v));
  const choice = (k, opts) => seg(opts, S[k], (v) => set(k, v));

  const pages = {
    video: () => [
      row('Display mode', 'Fullscreen uses the browser fullscreen API', choice('displayMode', [['windowed', 'Windowed'], ['fullscreen', 'Fullscreen']])),
      row('Graphics quality', 'Shadows, particle density, pixel ratio, crowd detail', choice('quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']])),
      row('Post-processing', 'Bloom, filmic tone mapping, colour grading, vignette and film grain', tog('postFx')),
      row('Speed effects', 'Subtle edge fringing at supersonic speed', tog('speedFx')),
      row('Resolution scale', 'Internal render resolution relative to the window', slider('renderScale', 0.5, 1.5, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Frame-rate limit', '0 = match the display refresh', slider('fpsLimit', 0, 240, 30, (v) => (v ? v + ' fps' : 'Display'))),
      row('V-sync', 'Browsers always present frames on the display refresh; this cannot be disabled from a web page', h('span', { class: 'muted small' }, 'Always on (browser-controlled)')),
      row('Show FPS counter', null, tog('showFps')),
    ],
    camera: () => [
      row('Field of view', 'Horizontal degrees', slider('fov', 70, 120, 1, (v) => v + '°')),
      row('Speed FOV boost', 'Extra field of view at high speed (0 = off)', slider('speedFov', 0, 12, 1, (v) => '+' + v + '°')),
      row('Distance', 'Metres behind the car', slider('distance', 2, 4.5, 0.05, (v) => v.toFixed(2))),
      row('Height', null, slider('height', 0.5, 2, 0.05, (v) => v.toFixed(2))),
      row('Stiffness', 'How tightly the camera follows', slider('stiffness', 0, 1, 0.05, (v) => v.toFixed(2))),
      row('Swivel speed', 'How fast the camera turns with the car', slider('swivelSpeed', 1, 10, 0.1, (v) => v.toFixed(1))),
      row('Transition speed', 'Ball cam ↔ car cam blend', slider('transitionSpeed', 0.5, 3, 0.1, (v) => v.toFixed(1))),
      row('Camera shake', 'Off by default for competitive clarity', tog('cameraShake')),
      row('Ball cam on at start', null, tog('ballCamDefault')),
    ],
    controls: () => controlsPage(app, row, slider, tog),
    touch: () => [
      row('Tablet controls', 'On-screen joystick and buttons for touch screens. Auto turns them on when this device has a touch screen and no mouse.', choice('touchControls', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']])),
      row('Button size', null, slider('touchScale', 0.7, 1.4, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Opacity', 'How see-through the on-screen controls are', slider('touchOpacity', 0.2, 1, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Vibrate on press', 'Short buzz when a button is pressed (Android only)', tog('touchHaptics')),
      h('div', { class: 'small muted', style: { padding: '12px 4px', lineHeight: '1.6' } },
        h('b', null, 'Left thumb: '), 'touch anywhere on the left half to get a joystick. Push up to drive, down to reverse, sideways to steer. In the air it tilts and turns the car.', h('br'),
        h('b', null, 'Right thumb: '), 'JUMP (tap again with the stick pushed to flip), BOOST (hold), DRIFT (hold to powerslide, or to air roll in the air), CAM toggles ball cam.', h('br'),
        h('b', null, 'Top left: '), '☰ pause menu, ▤ scoreboard.'),
    ],
    audio: () => [
      row('Master volume', null, slider('volMaster', 0, 1, 0.05, (v) => Math.round(v * 100))),
      row('Music volume', 'Menu music', slider('volMusic', 0, 1, 0.05, (v) => Math.round(v * 100))),
      row('Effects volume', 'Engines, boost, impacts, goals, interface', slider('volEffects', 0, 1, 0.05, (v) => Math.round(v * 100))),
    ],
    access: () => [
      row('Colour-blind team colours', 'Blue vs yellow instead of blue vs orange', tog('colorblind')),
      row('Ball outline', 'Bright outline around the ball for visibility', tog('ballOutline')),
      row('Reduce flashing', 'Softer goal explosions and flashes', tog('reduceFlash')),
      row('Interface scale', null, slider('uiScale', 0.8, 1.4, 0.05, (v) => Math.round(v * 100) + '%')),
      row('Player name tags', null, tog('nameplates')),
      row('Skip goal replays', null, tog('skipReplays')),
      row('Hide quick chat', 'Hides messages from other players', tog('quickChatOff')),
    ],
    network: () => [
      row('Show latency and connection info', null, tog('showPing')),
      row('Dedicated server address', 'Leave empty to use the server that serves this page. Example: ws://192.168.1.20:8080/ws', serverField(app)),
      h('p', { class: 'small muted', style: { padding: '10px 4px' } }, 'Simulated latency, jitter and packet loss can be applied on the dedicated server with --lag, --jitter and --loss (see README).'),
    ],
  };

  const render = () => {
    clear(nav);
    for (const [id, label] of tabs) nav.appendChild(h('button', { class: 'cat' + (id === tab ? ' on' : ''), onclick: () => { tab = id; render(); } }, label));
    nav.appendChild(h('div', { style: { height: '12px' } }));
    nav.appendChild(h('button', { class: 'btn sm', onclick: () => app.confirm('Reset settings?', 'Restore all video, camera, audio and accessibility settings to defaults (key bindings are reset separately).', () => { Object.assign(S, DEFAULT_SETTINGS); app.applySettings('*'); render(); }) }, 'Reset to defaults'));
    clear(list);
    list.append(...pages[tab]());
  };
  render();
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, h('button', { class: 'btn ghost', onclick: () => app.closeSettings() }, '← Back'), h('h1', null, 'Settings'), h('div', { class: 'spacer' }), h('div', { class: 'crumb' }, 'Changes save automatically')),
    h('div', { class: 'settings' }, nav, list));
  return { el, update() { app.input.pollCapture(); } };
}

function serverField(app) {
  const inp = h('input', { class: 'text', placeholder: 'auto', value: app.prefs.serverUrl || '', style: { width: '100%' } });
  inp.addEventListener('change', () => { const v = inp.value.trim(); if (v && !/^wss?:\/\//.test(v)) { toast('Address must start with ws:// or wss://', 'err'); return; } app.prefs.serverUrl = v; app.savePrefs(); app.detectNetwork(); toast('Server address saved', 'ok'); });
  return inp;
}

function controlsPage(app, row, slider, tog) {
  const inp = app.input;
  let dev = app._bindDev || 'kb';
  const box = h('div');
  const draw = () => {
    clear(box);
    box.append(
      h('div', { class: 'row', style: { padding: '8px 4px 14px' } },
        seg([['kb', 'Keyboard & Mouse'], ['pad', 'Controller']], dev, (v) => { dev = app._bindDev = v; draw(); }),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn sm', onclick: () => { inp.resetDefaults(); toast('Bindings restored to defaults', 'ok'); draw(); } }, 'Default bindings')),
      ...ACTIONS.map((a) => {
        const binds = inp.binds[dev][a.id] || [];
        const btn = (slot) => {
          const b = h('button', { class: 'btn sm bind', title: 'Click, then press a ' + (dev === 'kb' ? 'key or mouse button' : 'controller button') }, keyLabel(binds[slot]) || '—');
          b.addEventListener('click', () => {
            b.classList.add('capturing'); b.textContent = dev === 'kb' ? 'Press a key…' : 'Press a button…';
            inp.startCapture(dev, (code) => {
              if (code === 'Escape' && a.id !== 'pause') { draw(); return; }
              const other = inp.bind(dev, a.id, slot, code);
              if (other) toast(`${keyLabel(code)} was used by “${ACTIONS.find((x) => x.id === other).label}” — swapped.`, '', 4500);
              draw();
            });
          });
          b.addEventListener('contextmenu', (e) => { e.preventDefault(); inp.clearBind(dev, a.id, slot); draw(); });
          return b;
        };
        return h('div', { class: 'setrow' }, h('div', { class: 'lbl' }, a.label), h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, btn(0), btn(1)));
      }),
      h('p', { class: 'small muted', style: { padding: '8px 4px' } }, 'Right-click a binding to clear it. Binding a key that is already in use swaps the two actions so nothing is left conflicting. Steering, pitch and yaw on a controller use the left stick.'),
      row('Push-to-talk', 'Voice chat needs a voice relay service, which this build does not include', h('span', { class: 'muted small' }, 'Not available')),
    );
  };
  draw();
  return [box,
    row('Controller deadzone', null, slider('deadzone', 0, 0.4, 0.01, (v) => v.toFixed(2))),
    row('Steering sensitivity', 'Controller', slider('steerSensitivity', 0.5, 2, 0.05, (v) => v.toFixed(2))),
    row('Aerial sensitivity', 'Controller pitch', slider('aerialSensitivity', 0.5, 2, 0.05, (v) => v.toFixed(2))),
    row('Invert aerial pitch', null, tog('invertPitch')),
    row('Mouse sensitivity', 'Garage and replay camera orbit', slider('mouseSensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2))),
  ];
}
