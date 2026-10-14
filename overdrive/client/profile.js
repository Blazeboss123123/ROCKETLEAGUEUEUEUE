// Local player profile (progression, statistics, cosmetics) and persisted settings.
// This is a LOCAL profile stored on this device — not an authenticated online account.
import { store } from './store.js';
import { DEFAULT_LOADOUT, CATALOG, unlockLevel, unlocksAt } from './cosmetics.js';

export const DEFAULT_SETTINGS = {
  // display
  quality: 'high', renderScale: 1, fpsLimit: 0, vsync: true, displayMode: 'windowed', showFps: false,
  // camera
  fov: 108, distance: 3.0, height: 1.05, speedFov: 6, stiffness: 0.45, swivelSpeed: 4.5, transitionSpeed: 1.2, cameraShake: false, ballCamDefault: true,
  // controls
  mouseSensitivity: 1, steerSensitivity: 1, aerialSensitivity: 1, deadzone: 0.12, invertPitch: false,
  // audio
  volMaster: 0.8, volMusic: 0.5, volEffects: 0.8,
  // gameplay / accessibility
  colorblind: false, ballOutline: false, uiScale: 1, reduceFlash: false, nameplates: true, showPing: true, skipReplays: false, quickChatOff: false,
  arena: 'stadium',
};

export function loadSettings() { return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) }; }
export function saveSettings(s) { store.set('settings', s); }

const XP_BASE = 400, XP_STEP = 120;
export function xpToNext(level) { return XP_BASE + (level - 1) * XP_STEP; }

export function emptyStats() { return { matches: 0, wins: 0, losses: 0, goals: 0, assists: 0, saves: 0, shots: 0, touches: 0, mvps: 0, timePlayed: 0, onlineMatches: 0 }; }

export class Profile {
  constructor() {
    const d = store.get('profile', null);
    this.name = d?.name || 'Player';
    this.level = d?.level || 1;
    this.xp = d?.xp || 0;
    this.stats = { ...emptyStats(), ...(d?.stats || {}) };
    this.loadout = { ...DEFAULT_LOADOUT, ...(d?.loadout || {}) };
    this.history = d?.history || [];
    this.created = d?.created || Date.now();
    this.validateLoadout();
  }
  save() { store.set('profile', { name: this.name, level: this.level, xp: this.xp, stats: this.stats, loadout: this.loadout, history: this.history.slice(0, 20), created: this.created }); }

  isUnlocked(slot, id) { return unlockLevel(slot, id) <= this.level; }
  validateLoadout() {
    for (const slot of Object.keys(CATALOG)) {
      if (!this.isUnlocked(slot, this.loadout[slot]) || !CATALOG[slot].some((x) => x.id === this.loadout[slot])) this.loadout[slot] = DEFAULT_LOADOUT[slot];
    }
  }

  // Record a completed match. Returns {xpGained, levelUps:[{level, unlocks}]}
  recordMatch({ won, lost, stats, durationSec, mvp, online, modeLabel, score, team }) {
    const s = this.stats;
    s.matches++; if (won) s.wins++; if (lost) s.losses++;
    if (online) s.onlineMatches++;
    if (stats) { s.goals += stats.goals; s.assists += stats.assists; s.saves += stats.saves; s.shots += stats.shots; s.touches += stats.touches; }
    if (mvp) s.mvps++;
    s.timePlayed += Math.round(durationSec || 0);
    let xpGained = 150 + (won ? 100 : 0) + Math.round((stats?.score || 0) * 0.6) + (mvp ? 50 : 0);
    this.xp += xpGained;
    const levelUps = [];
    while (this.xp >= xpToNext(this.level)) { this.xp -= xpToNext(this.level); this.level++; levelUps.push({ level: this.level, unlocks: unlocksAt(this.level) }); }
    this.history.unshift({ at: Date.now(), mode: modeLabel, score, team, won, stats, online });
    this.save();
    return { xpGained, levelUps };
  }

  // Network-friendly compact cosmetics
  cosmetics() { return { ...this.loadout }; }
}
