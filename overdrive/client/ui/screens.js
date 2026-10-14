// Menu screens: main, play, private match, practice, training, matchmaking, lobby, results,
// profile, statistics, credits, exit.
import { h, clear, seg, toast, bannerStyle, fmtDuration } from './dom.js';
import { MODES, BOTS, TEAM_COLORS } from '../../shared/config.js';
import { CODE_RE } from '../../shared/protocol.js';
import { DRILLS } from '../training.js';
import { ARENA_THEMES } from '../render/arenaMesh.js';
import { itemName } from '../cosmetics.js';
import { xpToNext } from '../profile.js';

const back = (app, to = 'main') => h('button', { class: 'btn ghost', onclick: () => app.go(to) }, '← Back');

function playerCard(app) {
  const p = app.profile;
  const xpPct = Math.min(100, (p.xp / xpToNext(p.level)) * 100);
  return h('div', { class: 'panel player-card' },
    h('div', { class: 'banner', style: { background: bannerStyle(p.loadout.banner) } }),
    h('div', { class: 'pc-body' },
      h('div', { class: 'row' }, h('div', { class: 'name grow' }, p.name), h('div', { class: 'kbd' }, 'LV ' + p.level)),
      h('div', { class: 'title' }, itemName('title', p.loadout.title)),
      h('div', { class: 'xpbar' }, h('i', { style: { width: xpPct + '%' } })),
      h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${p.xp} / ${xpToNext(p.level)} XP · Local profile on this device`)));
}

function netBadge(app) {
  const n = app.net;
  const items = [];
  if (n.server) items.push([n.serverOk ? 'ok' : 'bad', n.serverOk ? 'Dedicated server online' : 'Dedicated server unreachable']);
  if (n.room) items.push(['ok', 'Shared-link multiplayer ready (browser host)']);
  if (!n.server && !n.room) items.push(['warn', 'Offline — online play needs a server or the shared link']);
  return h('div', { class: 'netbadge' }, items.map(([c, t]) => h('span', { class: 'row', style: { gap: '6px' } }, h('i', { class: 'dot ' + c }), t)));
}

export function mainMenu(app) {
  const nav = [
    ['play', 'Play', 'Online, private matches and bot practice', true],
    ['training', 'Training', 'Free play and skill drills'],
    ['garage', 'Garage', 'Choose and inspect your car'],
    ['customise', 'Customise', 'Paint, wheels, trails and more'],
    ['profile', 'Profile'], ['stats', 'Statistics'], ['settings', 'Settings'], ['credits', 'Credits'], ['exit', 'Exit'],
  ];
  const el = h('div', { class: 'screen dim' },
    h('div', { class: 'menu-main', style: { margin: 'auto 0' } },
      h('div', { class: 'logo' }, h('div', { class: 'l1' }, 'PROJECT'), h('div', { class: 'l2' }, 'OVERDRIVE'), h('div', { class: 'bar' })),
      h('nav', { class: 'mainnav', 'aria-label': 'Main menu' },
        nav.map(([id, label, sub, big]) => h('button', { class: 'navbtn' + (big ? ' big' : ''), onmouseenter: () => app.audio.play('hover'), onclick: () => { app.uiClick(); app.go(id === 'customise' ? 'garage' : id, id === 'customise' ? { tab: 'paint' } : {}); } },
          label, sub ? h('small', null, sub) : null)))),
    playerCard(app),
    netBadge(app));
  return { el };
}

export function playMenu(app) {
  const st = app.prefs;
  const modeSel = (key) => seg(Object.keys(MODES).map((m) => [m, m]), st[key], (v) => { st[key] = v; app.savePrefs(); });
  const online = app.net.server || app.net.room;
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app), h('h1', null, 'Play'), h('div', { class: 'spacer' }), h('div', { class: 'crumb' }, online ? (app.net.server ? 'Dedicated server' : 'Browser-hosted (shared link)') : 'Offline')),
    h('div', { class: 'tiles' },
      h('div', { class: 'panel tile' + (online ? '' : ' locked') },
        h('div', { class: 'tag' }, online ? 'Online' : 'Unavailable'),
        h('div', { class: 't' }, 'Casual'),
        h('p', null, online ? 'Public matchmaking. Empty seats are filled by labelled bots, and players can drop in.' : 'Needs the dedicated server or the shared claude.ai link. Use Practice for offline play.'),
        h('div', { class: 'row', style: { marginTop: '12px' } }, modeSel('casualMode'),
          h('button', { class: 'btn primary', disabled: !online, onclick: () => { app.uiClick(); app.playOnline(st.casualMode); } }, 'Find match'))),
      h('div', { class: 'panel tile locked' },
        h('div', { class: 'tag' }, 'Requires ranking service'),
        h('div', { class: 't' }, 'Competitive'),
        h('p', null, 'Ranked play needs authenticated accounts and a rating service, which this build does not include. See the README for the plan.')),
      h('div', { class: 'panel tile' + (online ? '' : ' locked'), onclick: (e) => { if (online && !e.target.closest('button')) app.go('private'); } },
        h('div', { class: 'tag' }, 'Online · Friends'),
        h('div', { class: 't' }, 'Private Match'),
        h('p', null, 'Create a lobby and share its 6-character code, or join a friend with theirs.'),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', disabled: !online, onclick: () => app.go('private') }, 'Create / Join'))),
      h('div', { class: 'panel tile', onclick: (e) => { if (!e.target.closest('button')) app.go('practice'); } },
        h('div', { class: 'tag' }, 'Offline'),
        h('div', { class: 't' }, 'Practice vs Bots'),
        h('p', null, 'Full match against AI teammates and opponents. Runs entirely on this device.'),
        h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn', onclick: () => app.go('practice') }, 'Set up'))),
      h('div', { class: 'panel tile', onclick: () => app.go('training') },
        h('div', { class: 'tag' }, 'Offline'),
        h('div', { class: 't' }, 'Training'),
        h('p', null, 'Free play and drills: striking, aerials, saves and dribbling.'))));
  return { el };
}

function arenaPicker(app, key, allowExperimental) {
  const opts = Object.values(ARENA_THEMES).filter((a) => allowExperimental || !a.params).map((a) => [a.id, a.name]);
  const blurb = h('div', { class: 'small muted' }, ARENA_THEMES[app.prefs[key]]?.blurb || '');
  return h('div', { class: 'col' }, seg(opts, app.prefs[key], (v) => { app.prefs[key] = v; app.savePrefs(); blurb.textContent = ARENA_THEMES[v].blurb; }), blurb);
}

export function practiceMenu(app) {
  const p = app.prefs;
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app, 'play'), h('h1', null, 'Practice vs Bots'), h('div', { class: 'spacer' }), h('div', { class: 'crumb' }, 'Offline · not an online match')),
    h('div', { class: 'panel', style: { maxWidth: '760px' } },
      h('div', { class: 'col', style: { gap: '18px' } },
        h('div', null, h('h3', null, 'Format'), seg(Object.keys(MODES).map((m) => [m, MODES[m].label]), p.practiceMode, (v) => { p.practiceMode = v; app.savePrefs(); })),
        h('div', null, h('h3', null, 'Bot difficulty'), seg(Object.entries(BOTS).map(([k, b]) => [k, b.label]), p.practiceBots, (v) => { p.practiceBots = v; app.savePrefs(); })),
        h('div', null, h('h3', null, 'Arena'), arenaPicker(app, 'practiceArena', true)),
        h('div', null, h('h3', null, 'Match length'), seg([[120, '2 min'], [300, '5 min'], [600, '10 min']], p.practiceLength, (v) => { p.practiceLength = v; app.savePrefs(); })),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => { app.uiClick(); app.practice({ mode: p.practiceMode, difficulty: p.practiceBots, arena: p.practiceArena, duration: p.practiceLength }); } }, 'Start match')))));
  return { el };
}

export function privateMenu(app) {
  const p = app.prefs;
  const codeIn = h('input', { class: 'text code', maxlength: 6, placeholder: 'CODE', 'aria-label': 'Join code', autocomplete: 'off', spellcheck: 'false' });
  codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
  const join = () => {
    const c = codeIn.value.trim().toUpperCase();
    if (!CODE_RE.test(c)) { toast('Codes are 6 characters (letters and digits, no O/0/I/1).', 'err'); return; }
    app.joinPrivate(c);
  };
  codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app, 'play'), h('h1', null, 'Private Match')),
    h('div', { class: 'lobby-grid', style: { maxWidth: '1100px' } },
      h('div', { class: 'panel' },
        h('h2', null, 'Create'),
        h('div', { class: 'col', style: { gap: '16px' } },
          h('div', null, h('h3', null, 'Format'), seg(Object.keys(MODES).map((m) => [m, m]), p.privateMode, (v) => { p.privateMode = v; app.savePrefs(); })),
          h('div', null, h('h3', null, 'Fill empty seats with bots'), seg([['off', 'No bots'], ['rookie', 'Rookie'], ['pro', 'Pro'], ['elite', 'Elite']], p.privateFill, (v) => { p.privateFill = v; app.savePrefs(); })),
          h('div', null, h('h3', null, 'Arena'), arenaPicker(app, 'privateArena', true)),
          app.net.room && !app.net.server ? h('p', { class: 'small muted' }, 'Your browser will host this match. Keep this tab open and in the foreground while playing; friends join with the code from this same shared link.') : null,
          h('button', { class: 'btn primary', onclick: () => { app.uiClick(); app.createPrivate({ mode: p.privateMode, fill: p.privateFill, arena: p.privateArena }); } }, 'Create lobby'))),
      h('div', { class: 'panel' },
        h('h2', null, 'Join'),
        h('div', { class: 'col', style: { gap: '16px' } },
          h('p', { class: 'muted' }, 'Enter the code your friend shared.'),
          h('div', { class: 'row' }, codeIn, h('button', { class: 'btn primary', onclick: join }, 'Join'))))));
  setTimeout(() => codeIn.focus(), 50);
  return { el };
}

export function trainingMenu(app) {
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app), h('h1', null, 'Training')),
    h('div', { class: 'tiles' }, Object.entries(DRILLS).map(([id, d]) => h('div', { class: 'panel tile', role: 'button', tabindex: 0, onclick: () => { app.uiClick(); app.startTraining(id); }, onkeydown: (e) => { if (e.key === 'Enter') app.startTraining(id); } },
      h('div', { class: 'tag' }, id === 'free' ? 'Sandbox' : `${d.count} rounds`), h('div', { class: 't' }, d.name), h('p', null, d.desc)))),
    h('div', { class: 'panel', style: { marginTop: '20px', maxWidth: '760px' } },
      h('h3', null, 'Controls refresher'),
      h('p', { class: 'small muted' }, 'Jump ', h('span', { class: 'kbd' }, 'Space'), ', then press it again with a direction to dodge. Hold ', h('span', { class: 'kbd' }, 'Left Shift'), ' to boost, ',
        h('span', { class: 'kbd' }, 'Left Ctrl'), ' + steer to air roll. ', h('span', { class: 'kbd' }, 'Q'), ' toggles ball camera. All keys can be remapped in Settings → Controls.')));
  return { el };
}

export function searching(app, params) {
  const status = h('div', { class: 'muted' }, 'Looking for an open lobby…');
  const el = h('div', { class: 'screen solid', style: { alignItems: 'center', justifyContent: 'center' } },
    h('div', { class: 'panel', style: { minWidth: '420px', textAlign: 'center' } },
      h('div', { class: 'row', style: { justifyContent: 'center', marginBottom: '16px' } }, h('div', { class: 'spinner' })),
      h('h2', null, `Searching · ${params.mode}`),
      status,
      h('div', { style: { marginTop: '18px' } }, h('button', { class: 'btn', onclick: () => app.cancelSearch() }, 'Cancel'))));
  const t0 = performance.now();
  return { el, update() { const s = (performance.now() - t0) / 1000; const st = app.searchStatus; status.textContent = `${s.toFixed(0)} s · ${st || 'Looking for an open lobby…'}`; } };
}

export function lobbyScreen(app) {
  const root = h('div', { class: 'screen solid' });
  let lastKey = '';
  const render = () => {
    const S = app.session; if (!S) return;
    const L = S.lobby;
    const key = JSON.stringify(L) + S.pid;
    if (key === lastKey) return;
    lastKey = key;
    clear(root);
    if (!L) { root.appendChild(h('div', { class: 'row', style: { margin: 'auto' } }, h('div', { class: 'spinner' }), h('div', { class: 'muted' }, 'Connecting…'))); return; }
    const me = L.players.find((p) => p.pid === S.pid);
    const isOwner = L.owner === S.pid;
    const teamSize = MODES[L.mode]?.teamSize || 3;
    const col = (team) => {
      const c = app.colors[team];
      const ps = L.players.filter((p) => p.team === team);
      const rows = ps.map((p) => h('div', { class: 'pl' },
        h('span', { class: 'nm' }, p.name, p.pid === S.pid ? h('span', { class: 'muted small' }, '  (you)') : null, p.pid === L.owner ? h('span', { class: 'muted small' }, '  · host') : null),
        p.bot ? h('span', { class: 'tagb bot' }, 'BOT') : h('span', { class: 'tagb' + (p.ready ? ' ready' : '') }, p.ready ? 'READY' : 'NOT READY'),
        !p.bot && p.ping ? h('span', { class: 'small muted' }, p.ping + ' ms') : null));
      for (let i = ps.length; i < teamSize; i++) rows.push(h('div', { class: 'pl empty' }, L.fill !== 'off' ? `Open seat — bot (${BOTS[L.fill]?.label || L.fill}) if empty` : 'Open seat'));
      return h('div', { class: 'panel teamcol', style: { '--c': c.css } }, h('h2', null, `${c.name} team`), rows,
        me && me.team !== team && L.phase === 'lobby' ? h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn sm', onclick: () => S.team(team) }, 'Switch to ' + c.name)) : null);
    };
    const kindLabel = S.kind === 'dedicated' ? 'Dedicated server' : S.kind === 'browser' ? 'Browser-hosted' : 'Offline';
    root.append(
      h('div', { class: 'topbar' }, h('button', { class: 'btn ghost', onclick: () => app.leaveSession() }, '← Leave'),
        h('h1', null, L.priv ? 'Private lobby' : 'Casual lobby'), h('div', { class: 'spacer' }),
        h('div', { class: 'crumb' }, `${MODES[L.mode]?.label || L.mode} · ${kindLabel}`)),
      h('div', { class: 'row', style: { marginBottom: '18px', gap: '24px' } },
        L.priv ? h('div', { class: 'panel row' }, h('div', null, h('div', { class: 'small muted' }, 'JOIN CODE'), h('div', { class: 'codebox' }, L.code)),
          h('button', { class: 'btn sm', onclick: () => { navigator.clipboard?.writeText(L.code).then(() => toast('Code copied', 'ok'), () => toast('Copy failed — select the code manually', 'err')); } }, 'Copy')) : null,
        !L.priv && L.startsIn != null ? h('div', { class: 'panel' }, h('div', { class: 'small muted' }, 'MATCH STARTS IN'), h('div', { class: 'codebox', style: { letterSpacing: '0.05em' } }, Math.ceil(L.startsIn) + ' s'),
          h('div', { class: 'small muted' }, 'or when everyone is ready · empty seats get bots')) : null,
        L.phase === 'results' ? h('div', { class: 'panel' }, 'Match finished — returning to lobby…') : null),
      h('div', { class: 'lobby-grid' }, col(0), col(1)),
      h('div', { class: 'row', style: { marginTop: '20px' } },
        me ? h('button', { class: 'btn ' + (me.ready ? '' : 'primary'), onclick: () => { app.uiClick(); S.ready(!me.ready); } }, me.ready ? 'Not ready' : 'Ready') : null,
        isOwner && L.priv ? h('div', { class: 'row' }, h('span', { class: 'small muted' }, 'Bot fill'), seg([['off', 'Off'], ['rookie', 'Rookie'], ['pro', 'Pro'], ['elite', 'Elite']], L.fill, (v) => S.setFill(v))) : null,
        h('div', { class: 'spacer grow' }),
        isOwner ? h('button', { class: 'btn primary', disabled: !L.players.filter((p) => !p.bot && p.conn).every((p) => p.ready), onclick: () => S.start() }, L.priv ? 'Start match' : 'Start now') : h('div', { class: 'small muted' }, isOwner ? '' : 'The host starts the match when everyone is ready.')));
  };
  render();
  return { el: root, update: render };
}

export function resultsOverlay(app, result, progress) {
  const S = app.session;
  const myTeam = (result.roster.find((r) => r.pid === S.pid) || {}).team;
  const won = result.winner === myTeam;
  const c = result.winner >= 0 ? app.colors[result.winner] : null;
  const stats = result.stats || {};
  let mvp = null, best = -1;
  for (const r of result.roster) if (r.team === result.winner && stats[r.pid] && stats[r.pid].score > best) { best = stats[r.pid].score; mvp = r.pid; }
  const table = h('table', { class: 'stats' },
    h('tr', null, ['Player', 'Score', 'Goals', 'Assists', 'Saves', 'Shots', 'Demos'].map((x) => h('th', null, x))),
    [0, 1].map((team) => [
      h('tr', { class: 'team-head', style: { '--c': app.colors[team].css } }, h('td', { colspan: 7 }, `${app.colors[team].name} — ${result.score[team]}`)),
      result.roster.filter((r) => r.team === team).sort((a, b) => (stats[b.pid]?.score || 0) - (stats[a.pid]?.score || 0)).map((r) => {
        const s = stats[r.pid] || {};
        return h('tr', { class: r.pid === S.pid ? 'me' : '' }, h('td', null, r.name, r.bot ? h('span', { class: 'muted small' }, ' (bot)') : null, r.pid === mvp ? h('span', { class: 'mvp' }, 'MVP') : null),
          h('td', null, s.score || 0), h('td', null, s.goals || 0), h('td', null, s.assists || 0), h('td', null, s.saves || 0), h('td', null, s.shots || 0), h('td', null, s.demos || 0));
      }),
    ]));
  const L = S.lobby;
  const votes = L?.players?.filter((p) => !p.bot && p.conn) || [];
  const rematchInfo = h('span', { class: 'small muted' });
  const updateVotes = () => { const l = S.lobby?.players?.filter((p) => !p.bot && p.conn) || []; rematchInfo.textContent = l.length > 1 ? `${l.filter((p) => p.rematch).length}/${l.length} voted rematch` : ''; };
  updateVotes();
  const el = h('div', { class: 'overlay' },
    h('div', { class: 'panel modal', style: { minWidth: 'min(820px, 94vw)' } },
      h('div', { class: 'result-head' },
        h('div', { class: 'w', style: { color: c ? c.css : '#fff' } }, result.winner < 0 ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT'),
        h('div', { class: 's' }, h('span', { style: { color: app.colors[0].css } }, result.score[0]), ' – ', h('span', { style: { color: app.colors[1].css } }, result.score[1]), result.overtime ? h('span', { class: 'small muted' }, '  (OT)') : null),
        h('div', { class: 'small muted' }, S.kind === 'offline' ? 'Offline practice match' : S.kind === 'browser' ? 'Online match · browser-hosted' : 'Online match · dedicated server')),
      table,
      progress ? h('div', { class: 'panel', style: { marginTop: '16px', background: 'var(--panel-2)' } },
        h('div', { class: 'row' }, h('b', null, `+${progress.xpGained} XP`), h('span', { class: 'muted' }, `Level ${app.profile.level} · ${app.profile.xp}/${xpToNext(app.profile.level)}`)),
        progress.levelUps.map((lu) => h('div', { style: { marginTop: '8px' } }, h('b', { style: { color: 'var(--accent)' } }, `LEVEL ${lu.level}! `), lu.unlocks.length ? 'Unlocked: ' + lu.unlocks.join(', ') : ''))) : null,
      h('div', { class: 'row', style: { marginTop: '18px' } },
        h('button', { class: 'btn primary', onclick: (e) => { S.rematch(); e.target.disabled = true; e.target.textContent = 'Waiting for others…'; } }, 'Rematch'),
        rematchInfo,
        h('div', { class: 'grow' }),
        S.priv || S.kind === 'offline' ? h('button', { class: 'btn', onclick: () => app.backToLobby() }, 'Back to lobby') : null,
        h('button', { class: 'btn', onclick: () => app.leaveSession() }, 'Main menu'))));
  void votes;
  return { el, update: updateVotes };
}

export function profileScreen(app) {
  const p = app.profile;
  const nameIn = h('input', { class: 'text', value: p.name, maxlength: 16, 'aria-label': 'Player name' });
  const save = () => { const v = nameIn.value.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16); if (!v) { toast('Name cannot be empty', 'err'); return; } p.name = v; p.save(); toast('Name saved', 'ok'); };
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app), h('h1', null, 'Profile')),
    h('div', { class: 'lobby-grid', style: { maxWidth: '1100px' } },
      h('div', { class: 'panel', style: { padding: 0 } },
        h('div', { style: { height: '110px', background: bannerStyle(p.loadout.banner) } }),
        h('div', { style: { padding: '18px 20px' } },
          h('div', { class: 'small muted' }, 'PLAYER NAME'),
          h('div', { class: 'row', style: { margin: '6px 0 14px' } }, nameIn, h('button', { class: 'btn sm', onclick: save }, 'Save')),
          h('div', { class: 'row' }, h('div', { class: 'kbd' }, 'LEVEL ' + p.level), h('div', { style: { color: 'var(--accent)', fontFamily: 'var(--display)', letterSpacing: '0.18em' } }, itemName('title', p.loadout.title))),
          h('div', { class: 'xpbar' }, h('i', { style: { width: (p.xp / xpToNext(p.level)) * 100 + '%' } })),
          h('div', { class: 'small muted', style: { marginTop: '6px' } }, `${p.xp} / ${xpToNext(p.level)} XP to level ${p.level + 1}`),
          h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn sm', onclick: () => app.go('garage', { tab: 'banner' }) }, 'Change banner / title')))),
      h('div', { class: 'panel' },
        h('h2', null, 'Account type'),
        h('p', null, h('b', null, 'Local profile.'), ' Your progress, unlocks and settings are stored in this browser only. There is no sign-in, cloud save or cross-device sync in this build.'),
        h('p', { class: 'muted small' }, 'Cosmetics are unlocked by levelling up from completed matches. Nothing can be purchased and there are no randomised rewards.'),
        h('p', { class: 'muted small' }, `Created ${new Date(p.created).toLocaleDateString()} · storage: ${app.storePersistent ? 'persistent' : 'session only (browser blocked storage)'}`),
        h('div', { class: 'row', style: { marginTop: '16px' } }, h('button', { class: 'btn danger sm', onclick: () => app.confirm('Reset profile?', 'This deletes your level, statistics and cosmetics on this device.', () => app.resetProfile()) }, 'Reset profile')))));
  return { el };
}

export function statsScreen(app) {
  const s = app.profile.stats;
  const rate = (a, b) => (b ? ((a / b) * 100).toFixed(0) + '%' : '—');
  const rows = [['Matches played', s.matches], ['Wins', s.wins], ['Losses', s.losses], ['Win rate', rate(s.wins, s.wins + s.losses)], ['Goals', s.goals], ['Assists', s.assists],
    ['Saves', s.saves], ['Shots', s.shots], ['Shooting accuracy', rate(s.goals, s.shots)], ['Ball touches', s.touches], ['MVPs', s.mvps], ['Online matches', s.onlineMatches], ['Time played', fmtDuration(s.timePlayed)]];
  const hist = app.profile.history;
  const el = h('div', { class: 'screen solid' },
    h('div', { class: 'topbar' }, back(app), h('h1', null, 'Statistics'), h('div', { class: 'spacer' }), h('div', { class: 'crumb' }, 'Lifetime · this device')),
    h('div', { class: 'lobby-grid', style: { maxWidth: '1100px' } },
      h('div', { class: 'panel' }, h('table', { class: 'stats' }, rows.map(([k, v]) => h('tr', null, h('td', null, k), h('td', null, v))))),
      h('div', { class: 'panel' }, h('h2', null, 'Recent matches'),
        hist.length ? h('table', { class: 'stats' }, h('tr', null, ['When', 'Mode', 'Result', 'G/A/S'].map((x) => h('th', null, x))),
          hist.slice(0, 12).map((m) => h('tr', null, h('td', null, new Date(m.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
            h('td', null, (m.mode || '') + (m.online ? ' · online' : '')), h('td', { style: { color: m.won ? 'var(--good)' : 'var(--bad)' } }, `${m.won ? 'W' : 'L'} ${m.score?.[m.team] ?? 0}-${m.score?.[1 - m.team] ?? 0}`),
            h('td', null, `${m.stats?.goals || 0}/${m.stats?.assists || 0}/${m.stats?.saves || 0}`))))
          : h('p', { class: 'muted' }, 'No matches yet. Finish a match to see it here.'))));
  return { el };
}

export function creditsScreen(app) {
  const el = h('div', { class: 'screen solid credits' },
    h('div', { class: 'topbar' }, back(app), h('h1', null, 'Credits')),
    h('div', { class: 'panel', style: { maxWidth: '820px' } },
      h('h2', null, 'Project Overdrive'),
      h('p', null, 'An original rocket-car football game. Game design, vehicle physics, networking, AI, procedural models, effects, interface and synthesised audio were created for this project.'),
      h('p', null, 'Rendering uses three.js (MIT licence, © three.js authors). Everything else — simulation, WebSocket server, matchmaking, bots, sound synthesis — is written from scratch with no other third-party code or assets.'),
      h('p', { class: 'muted small' }, 'Fonts: Chakra Petch and Inter via Google Fonts when available, with system fallbacks.'),
      h('p', { class: 'muted small' }, 'Built with Claude.')));
  return { el };
}

export function exitScreen(app) {
  const el = h('div', { class: 'screen solid', style: { alignItems: 'center', justifyContent: 'center', textAlign: 'center' } },
    h('div', { class: 'panel' }, h('h2', null, 'Thanks for playing'),
      h('p', { class: 'muted' }, 'Browsers do not let a page close its own tab — you can close it now. Your profile and settings are saved.'),
      h('button', { class: 'btn primary', onclick: () => app.go('main') }, 'Back to menu')));
  try { window.close(); } catch { /* ignore */ }
  return { el };
}

export { TEAM_COLORS };
