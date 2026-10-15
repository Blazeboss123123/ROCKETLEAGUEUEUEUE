// Project Overdrive — gameplay configuration.
//
// UNITS (used everywhere in the simulation):
//   length   metres (m)          time      seconds (s)
//   mass     kilograms (kg)      velocity  m/s,  acceleration m/s^2
//   angles   radians             angular velocity rad/s
//
// COORDINATE SYSTEM (right-handed, Y up):
//   +Y up.  Floor is y = 0.  Arena centre (kickoff spot) is the origin.
//   Z runs along the pitch length. Blue (team 0) defends the goal at -Z and attacks +Z.
//   X runs across the pitch width.
//   Car local axes: forward = +Z, up = +Y, left = +X, right = -X.
//
// The simulation runs at a fixed step (PHYSICS.dt). Nothing in shared/ reads wall-clock time.

export const PHYSICS = {
  tickRate: 120,          // simulation steps per second (fixed step)
  dt: 1 / 120,
  gravity: 6.5,           // m/s^2 (low, arcade gravity for long aerials)
};

export const ARENA = {
  length: 96,             // goal line to goal line (m)
  width: 70,              // side wall to side wall (m)
  height: 22,             // floor to ceiling (m)
  mode: 'soccar',         // soccar | hoops | dropshot
  plan: 'rect',           // rect | hex (plan-view outline)
  wallCurve: 4.5,         // radius of floor/wall/ceiling transitions on the side walls (m)
  endCurve: 2.5,          // tighter transition on the back walls: no big ramps beside the goals (m)
  cornerRadius: 15,       // radius of the vertical corner fillets in plan view (m)
  goalWidth: 18,          // goal mouth width (m)
  goalHeight: 6.6,        // goal mouth height (m)
  goalDepth: 9,           // depth of the goal box behind the goal line (m)
  goalCurve: 0.3,         // fillet radius inside the goal box (m)
  worldLimit: 80,         // anything beyond this distance from origin is invalid
};

export const CAR = {
  mass: 180,
  // Gameplay hitbox (identical for every cosmetic body). Half extents in metres.
  half: { x: 0.43, y: 0.19, z: 0.61 }, // half width, half height, half length
  hitboxOffset: { x: 0, y: 0.06, z: 0.06 }, // hitbox centre relative to the car origin (local)
  restHeight: 0.36,       // car origin height above a surface when resting on wheels
  groundProbe: 0.16,      // extra distance within which wheels count as touching
  suspensionK: 520,       // spring (1/s^2)
  suspensionC: 34,        // damping (1/s)

  // Ground driving
  throttleAccel: 16.0,    // m/s^2 at standstill
  throttleTopSpeed: 14.1, // throttle alone cannot exceed this (m/s)
  reverseTopSpeed: 13.0,  // m/s
  brakeAccel: 35.0,       // m/s^2 when throttle opposes motion
  coastDecel: 5.25,       // m/s^2 with no throttle
  maxSpeed: 23.0,         // absolute car speed cap (m/s)
  steerCurvatureLow: 0.69,  // path curvature (1/m) at 0 m/s, full steer
  steerCurvatureHigh: 0.055,// path curvature (1/m) at maxSpeed
  steerResponse: 18,      // how fast yaw rate follows the target (1/s)
  grip: 62,               // lateral tyre grip (m/s^2 of sideways correction)
  driftGrip: 9,           // lateral grip while powersliding
  driftSteerBoost: 1.35,  // extra curvature while powersliding
  stickyAccel: 3.25,      // pull towards the driving surface (m/s^2)
  alignRate: 14,          // how fast the chassis aligns to the surface normal (1/s)
  minWallSpeed: 2.5,      // below this speed on steep walls the car loses traction

  // Air control (angular accelerations rad/s^2, dampings 1/s)
  airPitchAccel: 12.0,
  airYawAccel: 9.0,
  airRollAccel: 36.0,
  airPitchDamp: 2.8,
  airYawDamp: 1.9,
  airRollDamp: 4.5,
  maxAngularSpeed: 5.5,
  airThrottleAccel: 0.66, // weak forward thrust in the air from throttle

  // Jumping
  jumpImpulse: 2.92,      // instant velocity change along car up (m/s)
  jumpHoldAccel: 14.6,    // extra acceleration while jump held (m/s^2)
  jumpHoldTime: 0.2,      // max hold duration (s)
  jumpMinTime: 0.025,     // minimum jump duration (s)
  doubleJumpWindow: 1.25, // time after first jump in which a second jump/dodge is allowed (s)
  doubleJumpImpulse: 2.92,
  jumpBuffer: 0.1,        // a jump pressed this long before landing still fires (s)

  // Dodges
  dodgeDeadzone: 0.5,     // stick magnitude needed to dodge instead of double jump
  dodgeImpulseForward: 5.6,   // instant speed gained by a front flip (m/s)
  dodgeImpulseBackward: 5.9,
  dodgeImpulseSide: 5.2,
  dodgeSideSpeedScale: 0.9,// extra side impulse proportional to speed (fraction of maxSpeed)
  dodgeDuration: 0.6,      // a flip is exactly one full rotation over this time (s)
  dodgeCancelAfter: 0.06,  // pulling the stick the opposite way after this cancels the flip rotation (s)
  dodgeFriction: 0.05,     // surface friction while flipping, so scraping the floor keeps momentum
  dodgeVerticalCancel: true,

  // Boost
  boostAccel: 9.9,         // m/s^2 along car forward
  boostUsePerSec: 33.3,    // boost units per second
  boostMax: 100,
  boostMinTime: 0.1,       // a tap of boost lasts at least this long (s)

  // Supersonic and demolitions
  supersonicSpeed: 21.95,  // m/s; at or above this speed the car is supersonic
  supersonicKeep: 21.0,    // stays supersonic until it drops below this speed
  demoAlign: 0.55,         // the attacker must be driving into the victim (cosine of the angle)
  respawnTime: 3,          // s before a demolished car respawns

  // Recovery
  recoverTorque: 9,        // rad/s^2 used to right a car resting on its roof
  recoverImpulse: 2.2,

  // Collisions
  wallRestitution: 0.2,
  wallFriction: 0.6,
  carCarRestitution: 0.15,
  bumpSpheres: [-0.3, 0.3], // local z offsets of car-car proxy spheres
  bumpRadius: 0.46,
};

export const BALL = {
  radius: 0.95,
  mass: 30,
  restitution: 0.6,
  friction: 0.35,           // surface friction coefficient
  rollingDecel: 0.35,       // m/s^2 while rolling on a surface
  drag: 0.0305,             // linear air drag (1/s)
  maxSpeed: 60,
  maxAngularSpeed: 6,
  // Car hit shaping — makes hits depend on car speed, contact direction and momentum.
  hitVertical: 0.4,         // vertical component scale of the hit direction
  hitForwardBias: 0.3,      // removes some of the car-forward component so side hits curve
  hitScaleLow: 0.6,         // scale at low relative speed
  hitScaleHigh: 0.5,        // scale at maxRelSpeed
  hitMaxRelSpeed: 46,
  hitCooldown: 0.1,         // s between extra hit impulses from the same car
  stuckTime: 4,             // s of near-zero motion off the floor before an unstick nudge
};

// Arena layouts. Competitive arenas share identical geometry; 'skyway' is a casual-only variant.
// Game modes. Every arena belongs to exactly one mode.
export const GAME_MODES = {
  soccar: { name: 'Soccar', blurb: 'Classic rocket-car football: get the ball in the net.' },
  hoops: { name: 'Hoops', blurb: 'Smaller court with raised hoops: the ball has to drop through the rim.' },
  dropshot: { name: 'Dropshot', blurb: 'No goals. Charge the ball with big hits, smash the floor tiles on their side, and drop it through a hole.' },
};

// Arena layouts. Soccar arenas share identical competitive geometry; 'skyway' is a casual-only variant.
export const ARENA_VARIANTS = {
  stadium: { name: 'Overdrive Stadium', mode: 'soccar', competitive: true, params: {} },
  solstice: { name: 'Solstice Park', mode: 'soccar', competitive: true, params: {} },
  harbor: { name: 'Neon Harbor', mode: 'soccar', competitive: true, params: {} },
  frostbite: { name: 'Frostbite Peak', mode: 'soccar', competitive: true, params: {} },
  mirage: { name: 'Dune Mirage', mode: 'soccar', competitive: true, params: {} },
  skyway: { name: 'Skyway (Experimental)', mode: 'soccar', competitive: false, params: { width: 80, height: 30, cornerRadius: 22, wallCurve: 6, endCurve: 2.8 } },
  court: { name: 'Downtown Court', mode: 'hoops', competitive: true, params: { mode: 'hoops', length: 74, width: 58, height: 18, wallCurve: 3.2, endCurve: 2.0, cornerRadius: 10 } },
  hexcore: { name: 'Hexcore', mode: 'dropshot', competitive: true, params: { mode: 'dropshot', plan: 'hex', length: 96, width: 84, height: 24, wallCurve: 4, endCurve: 4, cornerRadius: 6 } },
};
export function arenasForMode(mode) { return Object.entries(ARENA_VARIANTS).filter(([, v]) => v.mode === mode).map(([k]) => k); }

export const HOOPS = {
  rimHeight: 4.6,        // height of the rim above the floor (m)
  rimRadius: 2.9,        // inner ring radius (m)
  rimTube: 0.14,         // rim thickness (m)
  wallGap: 0.35,         // gap between the back wall and the rim (m)
  netDepth: 2.6,         // how far below the rim the net reaches (m)
  kickoffBallHeight: 7,  // ball drops in from here at kickoff (m)
};

export const DROPSHOT = {
  tileRadius: 3.6,       // hexagon tile circumradius (m)
  chargeLevel2: 16,      // accumulated hit strength for a charged ball (m/s)
  chargeLevel3: 36,      // ... and for a super-charged ball
  boostRegen: 10,        // boost units per second (no pads in Dropshot)
  kickoffBallHeight: 6,
  holeDepth: 8,          // how far below the floor a hole goes before it counts (m)
};

export const BOOST_PADS = {
  small: { amount: 12, respawn: 4, radius: 1.45, height: 1.65 },
  large: { amount: 100, respawn: 10, radius: 2.1, height: 1.7 },
};

export const MATCH = {
  duration: 300,            // regulation length (s)
  countdown: 3,             // kickoff countdown (s)
  goalPause: 5,             // celebration / replay before the next kickoff (s)
  startBoost: 33.3,
  assistWindow: 5,          // s
  maxOvertime: 0,           // 0 = unlimited sudden death
};

export const MODES = {
  '1v1': { teamSize: 1, label: 'Duel (1v1)' },
  '2v2': { teamSize: 2, label: 'Doubles (2v2)' },
  '3v3': { teamSize: 3, label: 'Standard (3v3)' },
  '4v4': { teamSize: 4, label: 'Chaos (4v4)' },
};

export const NET = {
  snapshotRate: 30,         // snapshots per second from the authority
  inputRedundancy: 8,       // recent inputs repeated in every input packet (packet-loss resilience)
  maxInputQueue: 24,        // server-side per-player input buffer (ticks)
  targetInputQueue: 2,      // ticks of jitter buffer the server tries to keep
  disconnectGrace: 60,      // s a disconnected player's slot is held for reconnection
  botTakeoverDelay: 3,      // s before a bot drives a disconnected player's car
  maxMsgBytes: 4096,
  maxMsgsPerSec: 200,
  matchmakingBotFill: 20,   // s before matchmaking offers to fill with bots
};

export const TEAM_COLORS = [
  { name: 'Blue', main: 0x2f7dff, light: 0x7fb4ff, dark: 0x0c2a66, css: '#2f7dff' },
  { name: 'Orange', main: 0xff8a1f, light: 0xffc078, dark: 0x6b2d00, css: '#ff8a1f' },
];

// Colour-blind friendly alternative palette (accessibility option)
export const TEAM_COLORS_ALT = [
  { name: 'Blue', main: 0x3b6cff, light: 0x9db6ff, dark: 0x10225e, css: '#3b6cff' },
  { name: 'Yellow', main: 0xffd21f, light: 0xffe98a, dark: 0x5e4a00, css: '#ffd21f' },
];

export const BOTS = {
  rookie: { label: 'Rookie', reaction: 0.35, aimNoise: 0.35, boostUse: 0.4, dodge: false, aerial: false, maxAerialHeight: 0, speedFactor: 0.82 },
  pro: { label: 'Pro', reaction: 0.18, aimNoise: 0.15, boostUse: 0.8, dodge: true, aerial: false, maxAerialHeight: 3.2, speedFactor: 0.95 },
  elite: { label: 'Elite', reaction: 0.08, aimNoise: 0.05, boostUse: 1, dodge: true, aerial: true, maxAerialHeight: 12, speedFactor: 1 },
};

export const BOT_NAMES = ['Axle', 'Nova', 'Piston', 'Rivet', 'Torque', 'Vector', 'Gauge', 'Sprocket', 'Ion', 'Chrome', 'Drift', 'Comet'];
