// Cosmetic catalogue. Purely visual / audio — none of these change the gameplay hitbox or handling.
// `lvl` is the player level at which an item unlocks (earned by playing; no purchases).

export const CATALOG = {
  body: [
    { id: 'comet', name: 'Comet', desc: 'Compact sports coupe', lvl: 1 },
    { id: 'strider', name: 'Strider', desc: 'Balanced all-rounder', lvl: 1 },
    { id: 'rampart', name: 'Rampart', desc: 'Angular rally brawler', lvl: 2 },
    { id: 'vanta', name: 'Vanta', desc: 'Futuristic prototype', lvl: 4 },
    { id: 'wisp', name: 'Wisp', desc: 'Open-wheel featherweight look', lvl: 6 },
  ],
  finish: [
    { id: 'gloss', name: 'Gloss', lvl: 1 }, { id: 'matte', name: 'Matte', lvl: 1 },
    { id: 'metal', name: 'Metallic', lvl: 3 }, { id: 'pearl', name: 'Pearlescent', lvl: 7 },
  ],
  wheels: [
    { id: 'spoke', name: 'Six-Spoke', lvl: 1 }, { id: 'disc', name: 'Aero Disc', lvl: 1 },
    { id: 'turbine', name: 'Turbine', lvl: 2 }, { id: 'tri', name: 'Tri-Blade', lvl: 4 },
    { id: 'mesh', name: 'Lattice', lvl: 5 }, { id: 'halo', name: 'Halo (animated)', lvl: 8 },
  ],
  wheelColor: [
    { id: 'chrome', name: 'Chrome', lvl: 1 }, { id: 'black', name: 'Satin Black', lvl: 1 },
    { id: 'team', name: 'Team Colour', lvl: 1 }, { id: 'gold', name: 'Gold', lvl: 6 }, { id: 'white', name: 'Ceramic White', lvl: 3 },
  ],
  trail: [
    { id: 'ion', name: 'Ion Stream (blue)', lvl: 1 }, { id: 'ember', name: 'Ember (orange)', lvl: 1 },
    { id: 'arc', name: 'Arc (electric)', lvl: 2 }, { id: 'vapour', name: 'Vapour (smoke)', lvl: 3 },
    { id: 'prism', name: 'Prism (geometric)', lvl: 5 }, { id: 'aurora', name: 'Aurora', lvl: 9 },
  ],
  goal: [
    { id: 'shock', name: 'Shockwave', lvl: 1 }, { id: 'burst', name: 'Starburst', lvl: 2 },
    { id: 'cubes', name: 'Pixel Storm', lvl: 4 }, { id: 'nova', name: 'Supernova', lvl: 7 },
  ],
  engine: [
    { id: 'v8', name: 'Rumble V8', lvl: 1 }, { id: 'turbine', name: 'Turbine Whine', lvl: 2 },
    { id: 'electric', name: 'Electric Hum', lvl: 3 }, { id: 'rotary', name: 'Rotary Buzz', lvl: 5 },
  ],
  antenna: [
    { id: 'none', name: 'None', lvl: 1 }, { id: 'orb', name: 'Glow Orb', lvl: 1 }, { id: 'flag', name: 'Pennant', lvl: 2 },
    { id: 'star', name: 'Star Tip', lvl: 4 }, { id: 'bolt', name: 'Bolt', lvl: 6 },
  ],
  decal: [
    { id: 'none', name: 'Clean', lvl: 1 }, { id: 'stripe', name: 'Twin Stripe', lvl: 1 }, { id: 'split', name: 'Two-Tone', lvl: 2 },
    { id: 'hex', name: 'Hex Plate', lvl: 3 }, { id: 'bolt', name: 'Lightning', lvl: 5 },
  ],
  topper: [
    { id: 'none', name: 'None', lvl: 1 }, { id: 'halo', name: 'Halo Ring', lvl: 2 }, { id: 'fin', name: 'Shark Fin', lvl: 3 },
    { id: 'cone', name: 'Traffic Cone', lvl: 4 }, { id: 'spikes', name: 'Crown Spikes', lvl: 8 },
  ],
  glow: [
    { id: 'none', name: 'Off', lvl: 1 }, { id: 'team', name: 'Team', lvl: 1 }, { id: 'cyan', name: 'Cyan', lvl: 2 },
    { id: 'magenta', name: 'Magenta', lvl: 3 }, { id: 'lime', name: 'Lime', lvl: 5 },
  ],
  banner: [
    { id: 'grid', name: 'Grid', lvl: 1 }, { id: 'waves', name: 'Waves', lvl: 1 }, { id: 'chevron', name: 'Chevron', lvl: 2 },
    { id: 'sunset', name: 'Sunset', lvl: 4 }, { id: 'circuit', name: 'Circuit', lvl: 6 },
  ],
  title: [
    { id: 'rookie', name: 'ROOKIE', lvl: 1 }, { id: 'driver', name: 'STREET DRIVER', lvl: 2 }, { id: 'keeper', name: 'GOALKEEPER', lvl: 3 },
    { id: 'aerialist', name: 'AERIALIST', lvl: 5 }, { id: 'overdrive', name: 'OVERDRIVE', lvl: 10 },
  ],
  horn: [
    { id: 'chime', name: 'Chime', lvl: 1 }, { id: 'horn', name: 'Air Horn', lvl: 1 }, { id: 'arp', name: 'Arpeggio', lvl: 3 }, { id: 'bass', name: 'Bass Drop', lvl: 6 },
  ],
};

export const PAINTS = [
  0xe5e7eb, 0x111827, 0x6b7280, 0xdc2626, 0xf97316, 0xfacc15, 0x22c55e, 0x14b8a6,
  0x0ea5e9, 0x2563eb, 0x7c3aed, 0xdb2777, 0x8b5e34, 0x65a30d, 0xf472b6, 0x38bdf8,
];

export const SLOT_LABELS = {
  body: 'Body', paint: 'Primary', accent: 'Secondary', finish: 'Finish', wheels: 'Wheels', wheelColor: 'Rim Finish',
  trail: 'Boost Trail', goal: 'Goal Explosion', engine: 'Engine Audio', antenna: 'Antenna', decal: 'Decal', topper: 'Topper',
  glow: 'Underglow', banner: 'Player Banner', title: 'Player Title', horn: 'Goal Celebration',
};

export const DEFAULT_LOADOUT = {
  body: 'strider', paint: 0xe5e7eb, accent: 0x111827, finish: 'gloss', wheels: 'spoke', wheelColor: 'chrome', trail: 'ion',
  goal: 'shock', engine: 'v8', antenna: 'none', decal: 'stripe', topper: 'none', glow: 'team', banner: 'grid', title: 'rookie', horn: 'chime',
};

export function itemName(slot, id) {
  const it = (CATALOG[slot] || []).find((x) => x.id === id);
  return it ? it.name : id;
}
export function unlockLevel(slot, id) {
  const it = (CATALOG[slot] || []).find((x) => x.id === id);
  return it ? it.lvl : 1;
}
// Unlocks granted at each level (for the level-up toast)
export function unlocksAt(level) {
  const out = [];
  for (const [slot, items] of Object.entries(CATALOG)) for (const it of items) if (it.lvl === level) out.push(`${SLOT_LABELS[slot]}: ${it.name}`);
  return out;
}
