// In-match HUD: score bug, clock, team indicators, boost gauge, kickoff countdown, goal banner,
// latency, quick chat, scoreboard, drill info. The centre of the screen stays clear.
import { h, clear, fmtClock } from './dom.js';
import { QUICK_CHAT } from '../../shared/protocol.js';

const ARC = 270; // degrees of the boost gauge

export class HUD {
  constructor(app) {
    this.app = app;
    this.cache = {};
    const R = 70, C = 2 * Math.PI * R, arcLen = C * ARC / 360;
    this.arcLen = arcLen;
    this.root = h('div', { class: 'hud' });
    this.bug = h('div', { class: 'scorebug' }, this.sb = h('div', { class: 'sc b' }, '0'), this.clock = h('div', { class: 'clock' }, '5:00'), this.so = h('div', { class: 'sc o' }, '0'));
    this.pips = h('div', { class: 'pips' }, this.pipB = h('div', { class: 'side' }), this.pipO = h('div', { class: 'side' }));
    this.hint = h('div', { class: 'board-hint' }, 'Hold TAB · Scoreboard');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 170 170');
    const mk = (attrs) => { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); for (const k in attrs) c.setAttribute(k, attrs[k]); svg.appendChild(c); return c; };
    mk({ cx: 85, cy: 85, r: R, fill: 'rgba(6,9,18,0.6)', stroke: 'rgba(255,255,255,0.1)', 'stroke-width': 12, 'stroke-dasharray': `${arcLen} ${C}` });
    this.arc = mk({ cx: 85, cy: 85, r: R, fill: 'none', stroke: '#ffb020', 'stroke-width': 12, 'stroke-linecap': 'butt', 'stroke-dasharray': `0 ${C}` });
    this.boostNum = h('div', { class: 'num' }, '33', h('small', null, 'BOOST'));
    this.boost = h('div', { class: 'boost' }, svg, this.boostNum);
    this.center = h('div', { class: 'center-msg' });
    this.goal = h('div', { class: 'goal-banner hidden' });
    this.net = h('div', { class: 'netinfo' });
    this.feed = h('div', { class: 'feed' });
    this.mid = h('div', { class: 'toast-mid' });
    this.replay = h('div', { class: 'replay-tag hidden' }, 'REPLAY');
    this.drill = h('div', { class: 'drillbox hidden' });
    this.qc = h('div', { class: 'quickchat hidden' }, QUICK_CHAT.slice(0, 9).map((t, i) => h('div', null, h('b', null, i + 1), t)), h('div', { class: 'muted small' }, 'Press a number · T to close'));
    this.board = h('div', { class: 'overlay hidden', style: { pointerEvents: 'none', background: 'rgba(3,5,10,0.35)' } });
    this.root.append(this.bug, this.pips, this.hint, this.boost, this.center, this.goal, this.net, this.feed, this.mid, this.replay, this.drill, this.qc, this.board);
  }

  set(el, key, val, fn) { if (this.cache[key] !== val) { this.cache[key] = val; fn(val); } }

  // state: see App.hudState()
  update(st) {
    const app = this.app;
    const training = st.kind === 'training';
    this.bug.classList.toggle('hidden', training);
    this.pips.classList.toggle('hidden', training);
    const key = (app.input?.binds?.kb?.scoreboard?.[0] || 'Tab').replace(/^Key/, '').replace(/^b(\d+)$/, 'pad $1').toUpperCase();
    this.set(this.hint, 'hint', training ? '' : `Hold ${key} · Scoreboard`, (v) => { this.hint.textContent = v; this.hint.classList.toggle('hidden', !v); });
    this.drill.classList.toggle('hidden', !training);
    if (!training) {
      this.set(this.sb, 'sb', st.score[0], (v) => { this.sb.textContent = v; });
      this.set(this.so, 'so', st.score[1], (v) => { this.so.textContent = v; });
      this.sb.style.background = `linear-gradient(180deg, ${app.colors[0].css}, ${app.colors[0].css}cc)`;
      this.so.style.background = `linear-gradient(180deg, ${app.colors[1].css}, ${app.colors[1].css}cc)`;
      this.set(this.clock, 'clock', fmtClock(st.clock, st.overtime), (v) => { this.clock.textContent = v; });
      this.clock.classList.toggle('ot', !!st.overtime);
      const pipKey = JSON.stringify(st.roster.map((r) => [r.pid, r.name, r.team, r.conn]));
      this.set(this.pips, 'pips', pipKey, () => {
        clear(this.pipB); clear(this.pipO);
        for (const r of st.roster) (r.team === 0 ? this.pipB : this.pipO).appendChild(h('div', { class: 'pip' + (r.conn === 0 ? ' dc' : ''), style: { '--c': app.colors[r.team].css } }, r.name + (r.bot ? ' 🤖' : r.conn === 3 ? ' (bot)' : '')));
      });
    } else {
      this.set(this.drill, 'drill', st.drillText, () => { clear(this.drill); this.drill.append(h('div', { class: 'h' }, st.drillTitle), h('div', { class: 's' }, st.drillText)); });
    }
    // boost gauge
    const b = Math.round(st.boost);
    this.set(this.boost, 'boost', b, (v) => {
      this.boostNum.firstChild.textContent = v;
      const C = 2 * Math.PI * 70;
      this.arc.setAttribute('stroke-dasharray', `${(this.arcLen * v) / 100} ${C}`);
      this.arc.setAttribute('stroke', v > 66 ? '#ffd166' : v > 25 ? '#ffb020' : '#ff6b3d');
      this.boost.classList.toggle('empty', v <= 0);
    });
    this.boost.classList.toggle('hidden', !st.hasCar);
    // centre: countdown / overtime / waiting
    let msg = '', sub = '';
    if (st.demoT > 0) { msg = 'DEMOLISHED'; sub = `Respawning in ${Math.ceil(st.demoT)}`; }
    else if (st.state === 'countdown' && st.timer > 0) { msg = String(Math.ceil(st.timer)); sub = st.overtime ? 'Overtime — next goal wins' : st.kickoffText || 'Kickoff'; }
    else if (st.goSince < 0.7) msg = 'GO!';
    else if (st.state === 'waiting') sub = 'Waiting for the match to start…';
    this.set(this.center, 'center', msg + '|' + sub, () => {
      clear(this.center);
      if (msg) this.center.appendChild(h('div', { class: 'big' }, msg));
      if (sub) this.center.appendChild(h('div', { class: 'sub' }, sub));
      this.center.classList.remove('pop'); void this.center.offsetWidth; this.center.classList.add('pop');
    });
    this.set(this.mid, 'mid', st.midText || '', (v) => { this.mid.textContent = v; });
    this.replay.classList.toggle('hidden', !st.replay);
    if (st.replay) this.set(this.replay, 'rep', st.replayHint, (v) => { this.replay.textContent = 'REPLAY  ·  ' + v; });
    // net info
    const lines = [];
    if (st.showPing && st.kind !== 'training' && st.kind !== 'offline') lines.push(`${st.kind === 'browser' ? 'Browser host' : 'Server'} · ${Math.round(st.rtt)} ms`);
    if (st.kind === 'offline') lines.push('Offline practice');
    if (st.code && st.priv && st.kind !== 'offline') lines.push('Code ' + st.code);
    if (st.conn === 'lost') lines.push('⚠ Connection lost');
    this.set(this.net, 'net', lines.join('\n'), () => { clear(this.net); lines.forEach((l) => this.net.appendChild(h('div', null, l))); });
    this.net.classList.toggle('hidden', !lines.length);
    this.qc.classList.toggle('hidden', !st.quickChatOpen);
  }

  goalBanner(team, scorer, assist, speed) {
    const c = this.app.colors[team];
    clear(this.goal);
    this.goal.append(h('div', { class: 'g', style: { '--c': c.css + 'cc' } }, 'GOAL!'),
      h('div', { class: 'who' }, scorer ? `${scorer}${assist ? '  ·  assist ' + assist : ''}` : `${c.name} scores`, speed ? `  ·  ${(speed * 3.6).toFixed(0)} km/h` : ''));
    this.goal.classList.remove('hidden');
    clearTimeout(this.goalT);
    this.goalT = setTimeout(() => this.goal.classList.add('hidden'), 2600);
  }

  feedMsg(text, color) {
    const d = h('div', { style: { '--c': color || 'var(--accent)' } }, text);
    this.feed.appendChild(d);
    while (this.feed.children.length > 5) this.feed.firstChild.remove();
    setTimeout(() => d.remove(), 6000);
  }

  showBoard(show, data) {
    this.board.classList.toggle('hidden', !show);
    if (!show) return;
    const key = JSON.stringify(data);
    if (this.cache.board === key) return;
    this.cache.board = key;
    const app = this.app;
    clear(this.board);
    const stats = data.stats || {};
    this.board.appendChild(h('div', { class: 'panel modal', style: { minWidth: 'min(760px, 94vw)' } },
      h('h2', null, 'Scoreboard'),
      h('table', { class: 'stats' },
        h('tr', null, ['Player', 'Score', 'Goals', 'Assists', 'Saves', 'Shots', 'Demos', 'Ping'].map((x) => h('th', null, x))),
        [0, 1].map((team) => [
          h('tr', { class: 'team-head', style: { '--c': app.colors[team].css } }, h('td', { colspan: 8 }, `${app.colors[team].name} — ${data.score[team]}`)),
          data.roster.filter((r) => r.team === team).map((r) => { const s = stats[r.pid] || {}; return h('tr', { class: r.pid === data.me ? 'me' : '' },
            h('td', null, r.name, r.bot ? h('span', { class: 'muted small' }, ' (bot)') : r.conn === 3 ? h('span', { class: 'muted small' }, ' (disconnected — bot driving)') : r.conn === 0 ? h('span', { class: 'muted small' }, ' (disconnected)') : null),
            h('td', null, s.score || 0), h('td', null, s.goals || 0), h('td', null, s.assists || 0), h('td', null, s.saves || 0), h('td', null, s.shots || 0), h('td', null, s.demos || 0),
            h('td', null, r.bot ? 'BOT' : data.ping?.[r.pid] ? data.ping[r.pid] + ' ms' : '—')); }),
        ]))));
  }
}
