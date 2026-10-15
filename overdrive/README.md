# Project Overdrive

An original rocket-car football game: drive, boost, jump, dodge and fly to put a giant ball in the other team's net. 1v1 to 4v4, five-minute matches with sudden-death overtime, bots at three difficulty levels, training drills, a garage with unlockable cosmetics, local progression — and authoritative multiplayer.

Everything except the three.js renderer (MIT) was written for this project: simulation, networking, WebSocket server, bots, procedural cars/arenas, synthesised audio and UI. No third-party game assets.

## Update 4: stability and performance (10+ players, high ping)

- **The server can't be taken down by one player any more**: errors in a message, a session or a disconnect are caught and logged; uncaught errors no longer kill the process (which dropped every match).
- **Reconnect race fixed**: on a bad connection the browser could reconnect before the server noticed the old socket died; when the old one closed it knocked the player offline and their game froze. Only the socket that currently owns a player can disconnect it now, and a reconnect replaces the stale socket.
- **No more ghost players** filling lobbies (join messages arriving after their socket closed).
- **Slow/dead connections**: players who can't keep up skip snapshots instead of the server buffering for them; silent drop-outs are cut after 15 s and a bot takes over.
- **Client can't freeze under lag**: only the newest snapshot is applied per frame, and re-simulation is capped, so a lag spike can't turn into hundreds of physics steps in one frame.
- **Adaptive jitter buffer**: the server holds enough inputs to bridge each player's packet gaps instead of dropping inputs (rubber-banding).
- **Lighter on small hosts**: 20 snapshots/s (was 30), inputs 30 packets/s (was 60), 60 server wake-ups/s (was 120+), WebSocket compression (permessage-deflate): 10 players went from ~271 KB/s to ~73 KB/s outgoing. Game files are cached and gzipped in memory with ETags (three.js 670 KB → 167 KB, repeat visits are a 304).
- Online clients ping the server every 4 minutes so free hosts don't idle it mid-match.

## Update 3: modes, maps, visuals

- **Game modes**: Soccar, **Hoops** (smaller court, raised rims on the back walls, the ball has to drop through the rim) and **Dropshot** (hexagonal arena, no goals: hits charge the ball through three levels, landings on the other side crack and then open floor tiles, and a ball through a hole scores). Pick the mode in Casual, Private Match and Practice; matchmaking queues per mode.
- **Eight arenas**: Overdrive Stadium, Solstice Park, Neon Harbor, Frostbite Peak, Dune Mirage, Skyway (casual-only), Downtown Court (Hoops) and Hexcore (Dropshot), each with its own sky, lighting, colour grade and surroundings.
- **Goals**: the back walls now meet the floor with a tight curve, so there are no ramps beside the goal posts.
- **Boost pads**: gradient floor decals, gradient-shaded plates and orbs, and light columns.
- **Rendering**: HDR post-processing (bloom, filmic tone mapping, colour grading, vignette, film grain, speed fringing), arena-matched reflections on cars, contact shadows, fresnel glass walls. Toggle under Settings → Video.
- **Camera on walls**: the camera slides along surfaces instead of snapping into the car, and its roll onto and off walls is eased.
- **Scoreboard**: hold Tab (hint under the score). Assists now count from the scorer's touch, so passes followed by a long roller are credited; save detection tracks the ball continuously.
- **Everything unlocked**: every cosmetic is available from the start.
- "Competitive" was removed from the Play menu.

## Update 2: movement, demolitions, bots, cars

- **Flips** now complete exactly one rotation and land wheels-down, add ~5.6 m/s, and keep you above the normal throttle top speed. Scraping the floor mid-flip no longer kills momentum. Pull the stick the opposite way to cancel a flip.
- **Demolitions**: hit an opponent nose-first while supersonic (≥ 21.95 m/s, shown by a white wake) to destroy them; they respawn at their own end after 3 s. Counted in the scoreboard.
- **Smoother motion**: fixed a render-interpolation hitch whenever a network snapshot arrived; body lean under acceleration, braking and cornering; a few degrees of extra field of view at speed (Settings → Camera).
- **Camera** now ray-marches against the arena and can't end up behind walls, the ceiling or goal frames.
- **Bots** follow the play instead of parking, back out when pinned against posts/walls, and drive through boost pads; idle time in 3v3 dropped from ~40 % to ~4 %.
- **Cars** rebuilt as lofted bodies with fender arches, tyres with tread, rims with brake discs and calipers, lights, twin boost nozzles and per-body aero.

## Why a browser game and not Unreal/Unity

The build environment had no Unreal Engine or Unity and no way to install them, so the game is built on the web platform: three.js for rendering and a dependency-free JavaScript simulation that runs identically on the server, on a browser host, and inside every client for prediction. The architecture (fixed-step authoritative simulation, input-only clients, prediction + reconciliation) is the same one you would build in UE5; the module boundaries below map one-to-one onto the brief's recommended modules.

## Run it

Requires Node.js 22+ (no `npm install` — there are no dependencies).

```bash
node server/server.js                 # http://localhost:8080 — game + dedicated server
node server/server.js --port 9000 --lag 120 --jitter 40 --loss 0.03   # simulate a bad connection
```

Friends join by opening `http://<your-ip>:8080`. Over the internet, forward the port or run it on a cloud VM (any $5 instance handles dozens of matches — see Performance).

Single-file builds (no server needed, offline play + browser-hosted multiplayer when opened on claude.ai):

```bash
node tools/build-artifact.mjs                # dist/overdrive.html (three.js from cdnjs)
node tools/build-artifact.mjs --local-three  # dist/overdrive-offline.html (fully self-contained)
```

## Controls (all remappable in Settings → Controls)

| Action | Keyboard | Controller |
|---|---|---|
| Accelerate / reverse | W / S | RT / LT |
| Steer, air yaw | A / D | Left stick |
| Air pitch | W / S | Left stick |
| Jump / dodge (jump again + direction) | Space | A / Cross |
| Boost | Left Shift | B / Circle |
| Powerslide / air roll (hold + steer) | Left Ctrl | X / Square |
| Air roll left / right | E / R | LB / RB |
| Ball camera toggle | Q | Y / Triangle |
| Look back | Right mouse | R-stick click |
| Scoreboard | Tab | View |
| Quick chat | T, then 1–9 | D-pad up |
| Pause | Esc | Menu |

**Tablets / touch screens** (Settings → Tablet: Auto / On / Off, button size, opacity): touch anywhere on the left half for a joystick (up = drive, down = reverse, sideways = steer; tilt and turn in the air). On the right: JUMP (tap again with the stick pushed to flip), BOOST (hold), DRIFT (hold: powerslide / air roll), CAM (ball cam). Top left: pause and scoreboard. Auto turns them on for devices with a touch screen and no mouse.

Binding a key that's already in use swaps the two actions (and tells you), so nothing is left conflicting. Jumps pressed up to 0.1 s before landing are buffered.

## Units and coordinates

Metres, seconds, kilograms, radians. Y is up, the floor is y = 0, the kickoff spot is the origin. Blue (team 0) defends −Z, orange defends +Z. Car local axes: forward +Z, up +Y, left +X. The simulation runs at a fixed 120 Hz (`shared/config.js → PHYSICS`). Every tunable — handling, jumps, dodges, boost, ball, arena size, pads, match rules, network rates, bot difficulty — lives in `shared/config.js`.

## Architecture

```
shared/            runs everywhere (server, browser host, client prediction, tests)
  config.js        all tunables + units
  math.js          vectors, quaternions, deterministic RNG
  arena.js         arena as a signed distance field + kickoff spawns + boost pad layout
  car.js           VehiclePhysics / JumpAndDodgeSystem / BoostSystem (controls & forces)
  ball.js          BallPhysics + ball prediction
  collide.js       car–arena, car–ball (speed/contact/momentum shaped hits), car–car
  world.js         MatchManager + GoalDetection + stats + snapshot (de)serialisation
  bot.js           BotController (roles/rotation, intercepts, boost, dodges, aerial solver)
  host.js          authoritative session: lobby, teams, ready-up, input queues, bots,
                   disconnect → bot takeover, reconnection, results, rematch
  client.js        NetworkPrediction: input sending, prediction, rollback/reconciliation,
                   visual error smoothing, interpolation
  protocol.js      message formats + strict validation of everything clients send
server/
  server.js        HTTP + WebSocket dedicated server, fixed-step loop, lag simulation, /status
  ws.js            RFC 6455 WebSocket implementation (zero dependencies)
  matchmaking.js   MatchmakingService (in-process implementation)
client/
  main.js          app flow, sessions, main loop, event presentation, replays, progression
  render/          scene, procedural arena/cars, particles, instancing/merging
  camera.js        chase cam, ball cam, look-back, arena collision, replay cinematics
  input.js         keyboard/mouse/gamepad, remapping, deadzones, persistence
  audio.js         fully synthesised Web Audio (engines, boost, impacts, goals, music)
  net/room.js      browser-hosted multiplayer over the claude.ai artifact room
  ui/              menus, lobby, HUD, garage, settings, results
  profile.js, cosmetics.js, store.js, training.js
tests/             node --test suites + Playwright UI smoke test
```

### Networking model

- **Authority** (dedicated server or a browser host) owns ball state, goals, the clock, kickoffs, boost consumption and pickups, collisions, team assignment, joins/leaves and results.
- **Clients send only intentions**: sequenced, quantised inputs (sent at 60 Hz with the last 8 repeated for loss resilience), ready/team choices and pings. Positions, boost, scores and goals sent by a client are rejected — there is no message that could carry them.
- **Server tick** 120 Hz; **snapshots** 30 Hz, quantised (mm / 1e-4) so every peer re-simulates from bit-identical state.
- **Prediction & reconciliation**: the client predicts the whole world. On each snapshot it rolls back, applies authority state, re-simulates its unacknowledged inputs, then smooths the visual difference over ~100 ms instead of snapping.
- **Jitter buffer**: the server consumes one input per tick, keeps a short queue, catches up if it grows, and repeats the last input on loss.
- **Disconnects**: a dropped player's inputs stop immediately; after 3 s a bot drives their car; they can rejoin with their token for 60 s; matches always run to completion.
- **Validation**: strict schema checks, input range/sequence checks, per-connection rate and size limits; repeat offenders are disconnected. Names and cosmetics are sanitised.

### Browser-hosted multiplayer (shared claude.ai link)

When the page runs on claude.ai, one player's browser runs the same `MatchHost` and others connect through the artifact *room* channel (latest-value presence, ~30 Hz, may drop frames). Join codes, ready-up, matchmaking adverts, snapshots and inputs all travel this way; the 4v4 host state stays under the 4 KiB presence budget. Limitations: the host must keep the tab open and visible; there is no host migration; players must be signed in and invited to the page.

## What's included vs. what needs infrastructure

Implemented and tested: dedicated server, public matchmaking (fills/backfills lobbies, starts on ready or after a timeout with bots in empty seats), private lobbies with join codes, team switching, ready-up, owner start, bot fill, reconnection, quick chat, latency display, results, rematch, return to lobby.

Needs external services (interfaces are in place, not deployed):
- **Ranked play**: needs authenticated accounts and a rating service (e.g. Glicko-2 over a database); not included.
- **Multi-server matchmaking**: replace `server/matchmaking.js` with a service backed by a shared queue (e.g. Redis) that allocates dedicated server processes; clients already connect via `?op=join&code=`.
- **Online accounts / cloud saves**: profiles are local to the browser and labelled as such.
- **Parties across sessions**, **voice chat / push-to-talk** (needs a voice relay; the bind is listed as unavailable).
- **Host migration** for browser-hosted matches.

## Testing

```bash
node --test tests/*.test.js     # 47 tests: physics, rules, bots, protocol, dedicated-server multiplayer, browser-host transport
node server/server.js --port 8099 & python3 tests/ui_smoke.py http://localhost:8099/   # 21 browser UI checks (Playwright)
```

Physics: stability at rest, acceleration/reverse/steering, jump and double jump, all dodge directions, single dodge until landing, boost rate, pad amounts and respawn, one pad per tick, wall rebounds, speed-dependent hits, goals in both nets, partial crossing is not a goal, kickoff reset and symmetric spawns, clock expiry, sudden-death overtime, NaN/out-of-world recovery, wall driving, frame-rate independence, no tunnelling at max ball speed.

Multiplayer (real server, real sockets): two clients see consistent scores; goals counted once; forged goals/scores/boost/snapshots are ignored and corrected; pad double-collection under 120 ms lag is impossible; invalid join codes rejected; malformed and oversized traffic dropped; disconnect → bot takeover → reconnect → match ends correctly; matchmaking fills with bots; state converges under 150 ms lag, 50 ms jitter and 5 % loss.

## Performance (measured)

- Server: 20 concurrent 4v4 matches with 8 elite bots each cost 1.4 ms per 120 Hz tick in total (0.07 ms per match; budget 8.3 ms).
- Client simulation: ~0.04 ms per tick for 8 cars; a typical reconciliation re-simulates ~15–25 ticks.
- Rendering: ~100 draw calls in a 4v4 match after instancing boost pads and merging static meshes. Frame rate on real GPUs was not measurable in the build sandbox (software rendering only); quality presets (shadows, particle density, resolution scale, crowd density) and a frame-rate limit are in Settings.

## Put it on a public website (free)

The quickest way to give anyone a link that works for multiplayer:

1. Put this folder in a GitHub repository (github.com → New repository → upload the files).
2. Sign in to [render.com](https://render.com) with GitHub → **New → Blueprint** → choose the repository. `render.yaml` sets everything up.
3. After a minute you get a public address like `https://project-overdrive.onrender.com`. Send that to friends.

The server reads the `PORT` environment variable, so the same works on Railway, Fly.io or any VPS (`npm start`). Free Render instances sleep when idle and take ~30–60 s to wake on the first visit.
