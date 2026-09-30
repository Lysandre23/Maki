# MAKI: Game Design Document (v0.1)

Working title. Top-down, pixel-simulated, roguelike tank combat in the browser.

---

## 1. Pitch

A black-and-white, comic-book pixel-art tank roguelike. Every room is a ruined building made of individual simulated pixels: walls crumble, floors scorch, smoke and fire swirl. You drive a modular tank through 10 rooms, destroying enemy tanks by shooting their weak points, and pick an upgrade after each room.

**Pillars**
1. **Everything breaks.** Walls, cover, and the room itself are pixels you can carve through.
2. **Aim at parts, not at health bars.** Enemy tanks have zones: shoot tracks to immobilize, the cannon to disarm, and the ammo rack to kill in one shot.
3. **The air is alive.** Fire, smoke, and steam are simulated, affect gameplay (line of sight, damage), and look great.
4. **Short, sharp runs.** 10 rooms, about 20-30 minutes.

---

## 2. Art direction

Reference: a black-and-white, comic-book top-down tank illustration (inspiration image, not included in the repo).

- **Palette:** 1-bit core (black, white, 2-3 grays). **Red is the only accent color** (HUD, fire core, damage flashes, blood-like "hit" markers).
- **Shading:** crosshatch and halftone dithering instead of gradients. Gas density is rendered with ordered (Bayer) dithering, which gives a comic-halftone look for free.
- **Materials:** brick with mortar lines, octagon-tile floor, cracked stone, rubble.
- **Comic VFX:** onomatopoeia sprites ("BLAM!", "KRAK!") with spiky burst outlines on big explosions, drawn as an overlay (not simulated).
- **Persistent marks:** tank tracks, scorch marks, and craters are written into the floor layer and stay for the room.
- **HUD:** red hand-drawn-style font, white-outline tank silhouettes showing part damage.
- **Resolution:** internal 480×270 cells, upscaled 4× to 1920×1080 with nearest-neighbor filtering.

---

## 3. Core gameplay

### 3.1 Room loop
1. Enter a room. Enemies are already placed.
2. Kill all enemy tanks. The room is cleared and the exit opens.
3. Choose 1 of 3 rewards.
4. Next room. Room 10 is a boss room.
5. Die and the run ends. Finish room 10 and you win the run.

### 3.2 Controls (simplified)
| Input | Action |
|---|---|
| W / S | Drive forward / backward |
| A / D | Rotate hull |
| Mouse | Aim turret (turret rotates separately and at limited speed) |
| Left click | Fire main cannon |
| Right click / Space | Secondary (machine gun at first, later ability slot) |
| R | Quick repair (limited charges) |

Under the hood, WASD is converted into **left/right track speeds** (differential drive). That way damaged tracks behave correctly (a dead left track makes you pull to that side) and "expert mode" with direct track control can be added later without changing the physics.

### 3.2b In-room systems (implemented 2026-10-01)
| Input | Action |
|---|---|
| Right click (hold) | Coaxial machine gun: chips masonry, 1.8x damage to tracks, can light crates. Overheats. |
| Space | Smoke grenades (3 per room): 3 canisters, cloud blocks enemy line of sight |
| 1-7 / click a part | Send a mechanic to that part (2 mechanics, A and B). Same part twice = both on it, third press recalls |
| E | Emergency patch (2 per room): a destroyed part (engine first) back to 35%, puts out engine fire |
| C | Power mode: BALANCED / DRIVE (speed up, turret+reload down) / GUNNERY (reload+turret up, speed down) |

- **Crew repair** consumes **spares** (hull costs twice as much), 2x faster when the tank stands still, wrecked parts repair at half speed.
- **Spares** drop from enemy wrecks as physical pickups (magnetised when close), so salvaging means driving into danger.
- **Armor by impact angle:** the struck face's normal is computed from the impact point; damage scales with how square the hit is; grazing hits **ricochet** (the shell is reflected and keeps flying, it can hit anyone, including its shooter).
- **Shot telegraph:** enemies "charge" before firing (dashed red laser to the first wall + muzzle glint, turret nearly locked) so shots can be dodged.
- **Target readout:** hovering an enemy shows its part status; the zone under the crosshair is named, weak spots flagged.
- **Wall collapse:** masonry fragments cut off from their structure and small relative to it (< 45%, < 450 cells) topple across their long axis away from the shot, spill rubble and dust, and crush tanks where they land.

### 3.2c Elements and builds (implemented 2026-10-01)
Color is information: the world stays black and white, and only elements are colored (fire red, ice pale blue, oil green).

- **Oil (green):** a liquid layer (depth per cell) that flows out, pools, slows tanks by 40%, and burns fast and hot. Explosions ignite it (50% per cell, 100% with NAPALM). Some rooms start with puddles.
- **Ice (pale blue):** a frost coat on the floor and walls, with a timer.
  - Frozen floor makes tanks lose grip (sideways slides, sluggish steering).
  - Frozen masonry takes 2x blast damage (4x with BRITTLE) and shatters into shards.
  - Frozen tanks are slowed up to 60% (drive, turret, reload).
  - Ice snuffs fires, and heat melts ice into steam.
- **Card system:** 42 cards in 4 rarities (common, rare, epic, legendary).
  - Card types:
    - **Sources:** give an element to the cannon, the machine gun, or the tank itself.
    - **Amplifiers:** only offered once you own a matching source.
    - **Build-around legendaries:** can appear at any time.
  - Draws favour cards that share tags with your build (element tags x1.8 weight). The first draw always contains an element source.
  - Cards show their element band, rarity frame, tags, a SYNERGY badge, and a YOUR BUILD strip.
  - Example combo: PHOENIX HULL (L, less damage the more the room burns) + LONG BURN (C) + FIREPROOF HULL (R).
- Cross-element payoffs: THERMAL SHOCK (fire on ice or ice on fire gives x3 damage and a cracked part), NAPALM (oil + fire), GRIP TREADS (oil + ice).

### 3.3 Player tank
The player tank is **not pixel-destructible**. It is a rigid body made of parts. Each part has its own HP and a hitbox inside the hull shape.

| Part | Function | When damaged | When destroyed |
|---|---|---|---|
| Hull | Overall HP | n/a | You die |
| Left / Right track | Movement | Slower, pulls to one side | That track is dead. The tank pivots in circles, and with both dead you are immobile |
| Turret | Aiming | Slower rotation | Turret locked in place |
| Cannon | Firing | Longer reload, spread | Cannot fire the main gun |
| Engine | Speed / power | Lower top speed, smoke trail | Stop, plus fire risk |
| Ammo rack | Ammo storage | Fire risk | Explosion: big damage to the hull |

Parts can be **repaired** with limited repair charges, between rooms, or by pickups.

### 3.4 Enemy tanks
Enemies use the same part model, but each **zone** has a rule:
- **Weak-point zones** (ammo rack, rear engine): one-shot kill with enough damage. A big explosion follows.
- **Functional zones** (tracks, turret, cannon): destroying one disables that function. A limping enemy stays dangerous but becomes easy to finish.
- **Armored zones** (front of hull, turret front): heavy damage reduction. AP shells can still penetrate.

Hit location is determined by where the projectile intersects the tank, and the angle matters (front armor is thick, rear armor is thin).

**Enemy types (first set)**
| Type | Behavior | Notes |
|---|---|---|
| Scout | Fast, light armor, chases and circles | Dies to anything, hard to hit |
| Gunner | Medium, keeps distance, strafes | The default enemy |
| Heavy | Slow, front armor nearly immune | Flank for the rear engine |
| Artillery | Stationary, lobs shells over walls with a marker telegraph | Forces movement |
| Flamer | Short range, sets terrain on fire | Uses the fire simulation |
| Boss (room 10) | Large tank, many separate destructible parts | Part-by-part fight |

### 3.5 Weapons and ammo
| Shell | Effect |
|---|---|
| AP (default) | Penetrates N cells of wall, small blast, high tank damage |
| HE | No penetration, big crater, splash damage, lots of debris and smoke |
| Incendiary | Sets cells on fire and creates lasting flames |
| Machine gun | Rapid low-damage bullets, chips at bricks and plates |

Ammo is limited (see the HUD in the reference) and refilled by pickups between rooms.

### 3.6 Rewards (post-room choices, pick 1 of 3)
- **New part / part upgrade:** armor plating, reinforced tracks, bigger cannon, second machine gun.
- **New shell type** or ammo capacity.
- **Repair:** restore part HP or add repair charges.
- **Passive perks:** e.g. faster reload, dust cloud hides you, fire-resistant hull, shells pierce one extra cell.
- **Risky deals:** a strong bonus with a drawback.

### 3.7 Progression of the 10 rooms
| Rooms | Content |
|---|---|
| 1-3 | Scouts and gunners. Learn movement and destruction. |
| 4-6 | Heavies and artillery. Flamers appear. Larger layouts. |
| 7-9 | Mixed groups, more hazards (oil, explosive barrels). |
| 10 | Boss. |

Rooms come from a few **handcrafted layout templates** (walls, cover, floor type) with randomized enemy groups and props, instead of fully procedural generation.

---

## 4. Simulation design (the technical core)

Top-down means **no gravity**. The design reflects that.

### 4.1 Grid and layers
World size: **480×270 cells** (1 cell = 1 screen pixel before 4× upscale). Stored as typed arrays (struct-of-arrays):

| Array | Type | Purpose |
|---|---|---|
| `material` | Uint8 | What is in each cell: empty, brick, stone, wood, metal, rubble, barrel, oil... |
| `hp` / `data` | Uint8 | Per-cell durability or variant (brick shade, mortar) |
| `floor` | Uint8 | Floor layer: tile pattern, scorch, craters, track marks (written by events, not simulated) |
| `gas` (density) | Float32 (lower res, e.g. 240×135) | Smoke / steam density |
| `gasVel` (x, y) | Float32 | Velocity field (blast pushes it, it swirls) |
| `heat` | Float32 or Uint8 | Temperature per cell (drives fire, steam) |

Colors are assigned at render time from the material and shading rules, which keeps the 1-bit look consistent.

### 4.2 Destruction
- **Static solids** (brick, stone, wood, metal) only change on damage events. They cost nothing per frame when idle.
- A shell hit calls `explode(x, y, radius, power)`: cells inside the radius lose durability depending on material and distance, and destroyed cells become **debris**.
- **Debris:** destroyed cells are converted into short-lived free particles with velocity (outward from the blast). When their speed falls to zero, they settle back into the grid as **rubble** cells (a weak, walkable-slow material). Rubble can be pushed and crushed by tanks.
- **Unsupported chunks:** after a big explosion, a flood fill from the wall's anchor points finds disconnected pieces, which then collapse into debris. This is expensive, so it only runs on dirty regions, and it is a **later milestone**.
- **Penetration:** AP projectiles raymarch through cells and subtract their energy from each cell's durability. They stop when energy runs out.

### 4.3 Tanks versus the pixel world
- Tanks are **rigid bodies** (position, angle, velocity, angular velocity), not grid cells.
- **Collision:** sample a set of points along the hull outline against the `material` grid. Push out along the averaged normal and apply friction. Rubble cells only slow the tank.
- **Crushing:** low-durability props and rubble can be driven through.
- **Track marks:** each frame, stamp the track positions into the `floor` layer.

### 4.4 Gas, smoke, steam, and fire
- **Gas field** (smoke, steam, dust) on a half-resolution grid, using a stable-fluids style solver: advect, diffuse, dissipate.
  - Explosions inject **velocity** (a radial push) and **density**, so blasts push smoke outward and it then curls around walls.
  - Destroyed walls open new paths for the gas to flow through.
  - Gas rendering uses Bayer dithering on density, producing halftone-looking clouds.
  - **Gameplay effect:** dense smoke blocks enemy line of sight (and yours, partly).
- **Fire** is cell-based:
  - Each burning cell has a `life` counter and emits heat plus smoke into the gas field.
  - It spreads to flammable neighbors (wood, oil, cloth props, explosive barrels) based on heat and a random chance.
  - Flames flicker with noise-driven dithering, with a red core.
  - Fire damages tanks' parts that stand in it (engine first).
- **Steam:** water or oil reacting with heat produces steam, which is gas with fast dissipation. Used for bursting pipes, hazards, and destroyed-engine effects.
- Burned surfaces are written into the `floor` layer as scorch, so the room keeps a record of the fight.

### 4.5 Simulation update order (per frame, fixed 60 Hz)
1. Input, AI decisions
2. Tank physics (track forces, collision)
3. Projectiles (raymarch, hit tests)
4. Explosions and damage events (grid changes, debris spawn)
5. Debris particle update (settle into rubble)
6. Fire update (active cells only)
7. Gas solver (half-res)
8. Render: floor, solids, debris, gas (dithered), tanks (sprites), HUD, comic overlays

### 4.6 Performance plan
- **Targets:** 60 fps on a mid-range laptop, 480×270 world.
- **Dirty rectangles and active lists:** only simulate where something is changing (debris, fire cells, gas above a density threshold).
- **Typed arrays only:** no per-cell objects.
- **Rendering:** write directly to an `ImageData` buffer of 480×270 and scale up on the canvas with `imageSmoothingEnabled = false`.
- **Budgets:** debris particles are capped (e.g. 4000), and the oldest settle early when the cap is reached.
- **Escape hatches if we are too slow:** Web Worker for the gas solver, lower gas resolution, or WebAssembly later.
- **Measurement first:** milestone 0 is a stress test that reports frame times.

---

## 5. Enemy AI
- **Senses:** line of sight is a raymarch through the grid (blocked by solids and by dense smoke). Enemies also hear shots.
- **Behaviors (state machine):** patrol, chase, strafe/hold, flank, retreat when damaged.
- **Part-aware:**
  - No tracks means it becomes a turret that rotates in place.
  - No cannon means it tries to ram you, or flees.
  - Destroyed turret means it cannot aim and only drives.
- **Terrain awareness:** a coarse navigation grid (for example 8×8 cells per node) is rebuilt when the terrain changes a lot. Enemies can also decide to shoot through a wall that blocks them.

---

## 6. UI / HUD
- Top left: score. Bottom left: ammo and a tank silhouette showing part health.
- Part colors are white (fine), hatched (damaged), red outline (destroyed).
- Reward screen is 3 cards in the same comic style.
- Between rooms: a short "ROOM CLEARED!" comic burst.

---

## 7. Tech stack
- **Browser**, HTML5 Canvas 2D, plain JavaScript (ES modules), no build step.
- Needs a small local server to run (e.g. `python -m http.server` or `npx serve`) because of ES modules.
- **Proposed structure**
```
maki/
  index.html
  src/
    main.js          game loop, init
    config.js        constants (grid size, budgets)
    world/           grid.js, materials.js, explosion.js, debris.js, fire.js, gas.js
    entities/        tank.js, parts.js, projectile.js, ai.js
    render/          renderer.js, dither.js, sprites.js, hud.js
    game/            rooms.js, rewards.js, run.js
    util/            input.js, rng.js, perf.js
```
- Sprites drawn procedurally at first (simple shapes), and we replace them with real pixel art later.

---

## 8. Milestones

| # | Goal | Done when |
|---|---|---|
| **M0** | **Performance prototype:** chunked grid (e.g. 64×64 cells per chunk) with a scrolling camera, only active/visible chunks simulated and rendered, brick wall, click to explode, debris that settles, FPS counter. The test map should be larger than one screen. | Many explosions stay at 60 fps, and cost depends on activity near the camera, not on map size |
| M1 | Drivable tank, collision with the pixel world, turret, AP shell that breaks walls, track marks | You can drive and shoot your way through a wall |
| M2 | Gas solver, fire, smoke, dithered rendering | Explosions push smoke, fires spread and burn out |
| M3 | Part system for tanks and hit zones, damage, HUD silhouette | Shooting tracks and cannon visibly changes behavior |
| M4 | One enemy type with AI, line of sight, part-aware behavior | A fair 1v1 fight is possible |
| M5 | Room loop: layouts, spawn, clear condition, reward screen (3 placeholder rewards) | A 3-room run can be played |
| M6 | Content: all enemy types, shell types, reward pool, 10 rooms, boss | A full run is possible |
| M7 | Polish: real pixel art, comic overlays, sound, screen shake, balance | Feels like the reference |

---

## 9. Open questions / decisions for later
- Sound design approach (procedural WebAudio vs recorded).
- Meta-progression between runs (unlocks, starting loadouts).
- Gamepad support.
- Expert mode with independent track control.
- Whether rubble should be persistent between rooms (currently: no).
- Art pipeline for real sprites (Aseprite or hand-drawn in code).
