# MAKI: Game Design Document (v0.2)

A top-down, black-and-white comic-book tank roguelike where every pixel is simulated. You command a squad of tanks across large natural battlefields to capture the enemy flag. Pause on a tactical map to give orders, then fight on the front line in the most powerful tank of your army.

> v0.2 (2026-10-01): pivot from "one tank clears rooms" to "squad battles for a flag". The elemental system (oil, ice, elemental cards) is removed. Fire and smoke stay as natural physics.

---

## 1. Pillars
1. **You are the spearhead.** Your tank is much stronger than any ally. Battles are won where you are.
2. **Command, then fight.** Pause, read the battlefield on the tactical map, give orders, and jump back into the action.
3. **Everything breaks and burns.** Walls crumble, fields and forests catch fire, smoke hides advances, wrecks become cover.
4. **Every loss matters.** Allies who die are gone for the run. Cards can add new tanks to your team.

---

## 2. Art direction and color rule

The world stays **black and white** (comic ink, halftone, cross-hatching, baked lighting). Color is **reserved for meaning**:

| Color | Meaning |
|---|---|
| **Yellow** | HUD, UI, cards, tactical map highlights (replaces the old red HUD) |
| **Red** | Enemies only: tank outline stroke, enemy shells, enemy markers |
| **Blue** | Allies: tank outline stroke, ally markers and orders |
| **Orange** | Fire and flames (was red) |

- **Team strokes:** every tank gets a 1-cell colored outline (red enemy, blue ally). The player's tank uses a distinct, stronger blue outline plus a small yellow pennant, so it reads instantly in a crowd.
- Comic onomatopoeia ("BLAM!", "KA-BOOM!") stay white/black with yellow bursts.

---

## 3. Run structure
- A **run** is a campaign of **7 battles** (6 battles + a final assault). Each battle lasts about **5 minutes**.
- After each won battle you **pick 1 of 3 cards** (see section 9).
- Your **team roster persists** between battles: surviving allies keep their damage (partially repaired) and dead allies are lost for good.
- **Defeat:** your own tank is destroyed. Allies alone can't carry the fight.
- **Victory:** capture the flag of the final assault.

---

## 4. The battle
- **Map:** large and horizontal, about 4 screens of area (2560x896 cells, camera 640x360). You spawn on the left edge, and the enemy flag is near the right edge.
- **Objective: capture the flag.**
  - A capture zone (radius ~60 cells) around the flag.
  - Capture fills while friendly tanks are inside and no enemy is. It takes ~8 s with the player alone and is faster with allies (+30% each).
  - It is contested (frozen) while enemies are in the zone, and decays slowly when nobody is there.
- **Enemy side:**
  - **Fixed defenses:** dug-in tanks, bunkers, and guns covering the approaches to the flag.
  - **Reinforcement waves** from the right edge, about every 60 s, growing with the battle number.
  - The **enemy commander AI** distributes its squads over the lanes of the map and reinforces the threatened ones.
- **Pace:** slower than the room prototype, with longer engagement ranges, longer reloads and heavier tanks. Bigger distances make positioning and orders matter.

---

## 5. Player tank
Keeps everything built so far:
- **Parts:** hull, 2 tracks, turret, cannon, engine and ammo rack, each with its own HP.
- **Armor:** by impact angle, with ricochets. Flanking pays: side ×0.9, rear ×1.6, PENETRATION ×1.5 for square hits.
- **Crew:** 2 mechanics, keys 1-7, consuming spares from wrecks.
- **Emergency patch (E), power modes (C), coaxial machine gun (RMB), smoke grenades (Space).**
- **LOADER RUSH** after kills, and **mission kills** (a tank with no cannon and no mobility is abandoned).

It is **much stronger than allies**: about 2-3× their hull, faster reload, better armor, and an exclusive card family.

---

## 6. Allies
- **Organized in squads** of 1 to 3 tanks. At the start of a run: 2 squads (e.g. 2 gunners + 2 scouts).
- **Same part model as enemies** (they lose tracks, get abandoned, burn), with simpler stats than the player.
- **Types** (unlocked by cards): Scout, Gunner, Heavy, Anti-tank (long range, fragile), Support (repairs nearby allies slowly).
- **Autonomous behaviour within their order:** use cover, focus the nearest threat, avoid friendly fire, fall back when badly damaged (if the stance allows).
- **Losses are permanent.** A dead ally leaves a wreck (cover plus spares, as usual).

---

## 7. Tactical map (pause)
- **Tab / M** opens it and pauses the game. Closing it resumes.
- **Schematic rendering** of the whole battlefield: terrain simplified to flat tones (forest, water, walls, roads, burning areas), the flag and capture zone, the front line.
- **Units shown as icons:**
  - your tank (yellow);
  - ally squads (blue, with health and current order);
  - **known enemies only** (red): what any friendly unit currently sees, plus last-seen ghosts that fade.
- **Orders, per squad:** click a squad, then click on the map.

| Order | Behaviour |
|---|---|
| **Move** | Go to the point by the drawn path, engage what they meet |
| **Attack** | Push into the zone, engage everything there |
| **Hold** | Take cover around the point and defend it |
| **Follow** | Escort the player's tank |

- **Stance** toggle per squad: **Aggressive** (never retreat) / **Cautious** (fall back to repair below 40% hull).
- Orders are drawn as blue arrows and stay visible faintly in-game (optional toggle).
- **Quick orders without the map** (optional, later): a key to order all squads to "Follow me" / "Hold here".

---

## 8. Enemy
- **Defenses:** entrenched tanks with sandbag or bunker cover near the flag and at chokepoints.
- **Waves:** squads entering from the right, targeting the lane where the player's forces are weakest or where the flag is threatened.
- **Commander AI:** evaluates each lane (friendly vs enemy strength) every few seconds and assigns squads Attack / Hold / Reinforce.
- Enemy types: the current Scout, Gunner, Heavy, a Boss for the final assault, plus Anti-tank guns (static).

---

## 9. Cards (two families)
Rarities are kept: common, rare, epic, legendary. Picked 1 of 3 after each battle.

**Player tank** (examples)
- Tungsten core (+damage), Autoloader (reload), Reinforced hull, Heavy tracks, Turbo engine, Front plating
- Big bore (blast radius), High velocity, Ricochet rounds, Cluster shells
- Speedy wrenches, Emergency kit, Smoke rack, Belt feed

**Team** (examples)
- **New tank:** a new ally joins (Scout / Gunner / Heavy / Anti-tank / Support, by rarity)
- Veteran crews (allies +accuracy, +reload), Field workshop (allies repaired fully between battles)
- Extra squad slot, Bigger squads (max 4)
- Combined arms (allies near you reload faster; you reload faster near allies)
- Rally (Follow-me squads get armor), Spotters (allies reveal enemies further on the tactical map)
- Quick capture (capture zone fills faster), Artillery support (legendary: a callable barrage on the tactical map)

Synergy logic: cards share tags (e.g. `escort`, `assault`, `defense`, `recon`), and draws favour tags you already own, as before.

---

## 10. Biomes (natural scenes)
Each battle picks a biome. Materials are simulated like the rest of the world.

| Biome | Features | New materials |
|---|---|---|
| **Field** | Open ground, hedgerows, hay bales, farm buildings, craters | **Grass** (flammable, burns in racing fronts), **Hay** |
| **Forest** | Dense trees (cover, line of sight blockers), clearings, trails | **Tree trunk** (solid wood), **Canopy** (hides units from above, flammable, blocks vision) |
| **Beach** | Sand, shallow water, dunes, concrete bunkers, beach obstacles | **Sand** (soft, cratered easily), **Water** (slows tanks, fire makes steam), **Concrete** |
| **Village** | The current building layouts (halls, lanes, courtyard) broken into houses | existing brick and stone |

Fire stays **natural physics** and is rendered **orange**: explosions and burning grass or trees can set a whole flank ablaze, and smoke blocks vision.

---

## 11. Physics kept and removed
- **Kept:** pixel destruction, debris and rubble, wall collapse and crushing, fire (orange), smoke/steam fluid, wrecks as terrain, track marks, scorch.
- **Removed:** oil, ice/frost, all elemental cards (fire, ice and oil families), elemental HUD colors.

---

## 12. Tech notes
- **World:** grid ~2560x896 (2.2 M cells, ~20 MB of typed arrays), 64x64 chunks, camera 640x360.
- **Gas solver:** limited to a window around the camera (e.g. 1.5 screens), frozen or dissipated outside it, so its cost stays at today's ~3 ms.
- **AI:** team-agnostic tank brain (target selection by team), with an **order layer** (move/attack/hold/follow + stance) on top and a **commander layer** for the enemy. Line-of-sight checks are staggered over ticks.
- **Navigation:** flow fields per order destination, cached and shared by squads with the same target.
- **Fog of war:** a per-team visibility grid at coarse resolution (e.g. 16-cell nodes), updated a few times per second.

---

## 13. Milestones and roadmap

| # | Goal | Status |
|---|---|---|
| **B1** | Elements removed, new color rule, wide Field battlefield, allies, flag capture | **Done** (2026-10-01) |
| **B2** | Tactical map: pause, schematic view, squads, orders, stances, fog of war | **Done** (2026-10-01) |
| B3 | Enemy defenses, reinforcement waves, commander AI, 5-minute pacing | Next |
| B4 | Cards v2, 7-battle run, roster persistence | |
| B5 | Biomes: Forest, Beach, Village | |
| B6 | Polish: sound, readability, balance, stutters | |

### 13.1 B1: what was built (state on 2026-10-01)
- **Removed:** oil, ice/frost, all elemental cards, element colors. Fire stays as natural physics (orange).
- **Colors** (`src/render/palette.js`):
  - **HUD:** yellow `#ffd21e`;
  - **outlines:** enemy red, ally blue, player bright blue plus a yellow pennant;
  - **fire:** orange `#ff8a1c`;
  - **shells:** player black, ally blue, enemy red.
- **Map:** 2560x896 cells (`ROOM_W`/`ROOM_H` in `src/config.js`), 64x64 chunks, camera 640x360.
- **Gas solver:** windowed, 1024x640 world cells (`GAS_WIN_W`/`GAS_WIN_H`). It follows the camera (`Gas.follow`), and outside the window fires burn without producing smoke.
- **Field biome** (`generateBattle` in `src/world/worldgen.js`):
  - dirt road west to east, plowed fields, soil patches, pebbles;
  - tall **GRASS** meadows: walkable, crushed flat by tanks, flammable, 40% damp (won't catch);
  - **HEDGE** hedgerows (north-south lines with gaps, plus east-west stubs), copses and lone trees;
  - **HAY** bales, 1-2 brick farmhouses, crates, fuel drums, old craters;
  - daylight with halftone cloud shadows.
- **Materials:** GRASS=9, HEDGE=10, HAY=11 (`src/world/materials.js`). Fire life, spread and heat are set per material in `src/world/fire.js`.
- **Navigation** (`src/world/nav.js`):
  - 12-cell nodes with 3x3 clearance;
  - BFS flow fields per destination, cached LRU (24 entries);
  - `rebuildRegion` refreshes only the area touched by destruction, tracked through `grid.navBox`.
- **AI** (`src/entities/ai.js`): team-agnostic.
  - Targets the nearest visible hostile (line of sight staggered, every 12 ticks per tank).
  - Avoids friendly fire.
  - Orders: **follow** (formation slot behind the player), **hold** (post + leash 240), **attack** (goal point).
  - Shots are telegraphed (charge, laser, glint).
- **Teams** (`src/game/game.js`):
  - `friendlies` = player + allies (team 0), `enemies` (team 1);
  - allies spawn from `roster` in `FORMATION` slots;
  - start roster: 2 gunners + 2 scouts;
  - dead allies are lost (`saveRoster` on victory), and damage carries over with a +20% patch (or full with Field Workshop).
- **Player tank:** hull 300 (gunner 110). It keeps parts, crew (1-7), emergency patch (E), power modes (C), machine gun (RMB), smoke (Space), angle armor, ricochets, penetration, mission kills and loader rush.
- **Flag** (`Game.updateFlag`):
  - zone radius 64;
  - capture 8 s alone, +30% per extra friendly;
  - frozen while contested, decays at 25% speed when empty;
  - shown as a dashed ring with a blue progress arc;
  - victory sets state `cleared`, then the reward screen.
- **HUD:** yellow top bar (battle, allies, enemies, kills, flag %), off-screen arrows (yellow to the flag with distance, blue to allies).
- **Cards** (`src/game/rewards.js`): 17 for your tank (yellow band) and 7 team cards (blue band), including new scout, gunner and heavy.
- **Measured (bot, headless):** ~2.4 ms simulation per tick, ~0.6 ms per frame. Battle generation takes ~0.5-0.8 s, the first frame up to ~35 ms. The bot wins in ~50 s, which is too fast; B3 fixes the pacing.

### 13.2 B2: Tactical map (done, see 13.2.1 for what was built)
**Goal:** pause, read the whole battlefield, give squads orders, resume.

1. **Squads**
   - New `Squad` objects: `{ id, tanks[], order, goal, stance, path[] }`. Allies start in 2 squads of 2 (roster order). Each roster entry stores its squad id so it persists between battles.
   - The AI reads its order from its squad instead of `t.ai.order`. Formation slots are computed per squad around the squad goal (or around the player for Follow).
2. **Orders** (extend `orderGoal` in `ai.js`):
   - **Move:** go to point by flow field, fight only when fired upon or a target is within 200.
   - **Attack:** go to point, engage everything seen on the way (current attack behaviour).
   - **Hold:** take position around the point, prefer cells with a solid between them and the nearest known enemy (cover search on the nav grid), leash 240.
   - **Follow:** current behaviour.
   - **Stance:** Aggressive (never retreat) / Cautious (below 40% hull, fall back toward the player and stop until the order is renewed or the hull is repaired by a Support ally later).
3. **Fog of war** (new `src/game/vision.js`):
   - Per-team visibility grid on 16-cell nodes, refreshed every 10 ticks.
   - Each friendly reveals a radius (~360) with a line-of-sight check per node, coarse and staggered.
   - `game.known` = enemies visible now plus last-seen ghosts (position and time, fading after 20 s).
4. **Tactical map UI** (new `src/render/tacmap.js`, drawn on the fx canvas or a dedicated overlay canvas):
   - Tab / M toggles it and **pauses the simulation** (the game loop skips `game.update`).
   - **Schematic terrain:** an offscreen bitmap built once per battle from the grid (flat tones for ground, grass, hedge, wood/hay, masonry, road, water later). Patched when `grid.navBox` changes, and burning areas overlaid in orange.
   - **Icons:** player (yellow), squads (blue, with a number, health bar and order glyph), known enemies (red, ghosts faded), flag with capture ring.
   - **Interaction:**
     - click a squad, or keys 1-4, to select it;
     - right-click a point to Move, Shift + right-click to Attack;
     - H to Hold at the squad's position or the clicked point, F to Follow, S to toggle stance.
     - Paths are drawn as blue arrows by sampling the flow field.
     - Number keys are already used for the crew in-game; on the map they select squads.
   - Optionally, the current orders are drawn faintly in-game as blue arrows (toggle with O).
5. **HUD:** a small squad panel (squad number, tanks alive, order) under the top bar.
6. **Done when:** sending a squad around a hedgerow to flank visibly changes the fight; Hold squads defend a point; Cautious squads retreat.

#### 13.2.1 B2: what was built (state on 2026-10-01)
- **View size:** the camera is no longer fixed at 640x360. `main.js` picks an integer pixel scale (about 400 rows tall) and sizes the view to fill the window (`setView`, live `VIEW_W`/`VIEW_H` bindings in `src/config.js`), capped at 896x544 so it stays inside the gas window. Composition at the cap costs ~0.7 ms.
- **Squads** (`src/game/squads.js`): `{ id, tanks, order, goal, heading, stance, orderT }`. Roster entries keep a `squad` id; recruits join the smallest squad with fewer than 3 tanks, else open a new one (4 max). Stances persist per squad id across battles (`game.stances`).
- **Orders:** `planSquad` gives each member an `ai.dest` (rows of two facing the order heading, snapped to passable nav nodes). Hold scores nav nodes within 60 cells for a solid 14-46 cells toward the nearest *known* enemy and re-plans every 2 s. The AI's `orderGoal` returns `passive` (Move) and `chase` flags instead of switching on the order name.
- **Cautious:** below 40% hull a tank falls back to 70 cells behind the player (`ai.retreat`). Renewing the order releases it and exempts it from retreating again under that order (`ai.exempt`). "Under fire" uses `tank.hurtT` (set on real part damage).
- **Fog of war** (`src/game/vision.js`): 16-cell nodes, 120 rays of 360 cells per friendly every 10 ticks (staggered), stopped by solids and thick smoke. `vision.known` holds seen enemies and last-seen ghosts (20 s). Cost ~0.2 ms per tick.
- **Tactical map** (`src/render/tacmap.js`, `#tac` canvas): built on open (sim frozen), 4 cells per schematic pixel with solids winning, fires baked in orange, fog veil (explored vs never seen). Squads drawn as blue tags with order, stance and mean hull; paths sampled from the flow field. Controls in the README. In-game, faint numbered arrows show squad orders (O toggles).
- **HUD:** squad panel under the top bar (pips per tank, order, stance).
- **Debug:** `window.maki = { game, tac }` in the browser console.

### 13.3 B3: Enemy and pacing
1. **Defenses** (worldgen):
   - sandbag walls (new **SAND** material: solid, low HP, absorbs blasts);
   - dug-in tank positions (U-shaped sandbags) at chokepoints and around the flag;
   - 1-3 static **anti-tank guns** (new tank type: no tracks, long range, fragile, small).
2. **Reinforcement waves:**
   - Enemy squads (2-4 tanks) enter from the east edge every ~60 s.
   - Wave size grows with the battle number and with time spent.
   - Waves stop once the flag is captured.
3. **Enemy commander AI** (new `src/game/commander.js`, runs every ~3 s):
   - Splits the map into 3 lanes (north, middle, south) and scores each by known friendly vs enemy strength and distance to the flag.
   - Assigns squads: reinforce the lane with the strongest friendly push, hold the flag with at least one squad, and send a counter-attack when it is clearly stronger in a lane.
4. **Pacing / balance:**
   - Engagement ranges up (SIGHT 460 to ~560), speeds -15%, reloads +20%.
   - Tune with the headless bot until a battle lasts ~5 minutes and the player is under real pressure.
5. **Done when:** battles last ~5 minutes and feel like pushing a front line, not clearing static targets.

### 13.4 B4: Full run and cards v2
1. **Run:** 7 battles (6 + final assault with the boss tank and stronger defenses). Rewards after each won battle; defeat when the player's tank dies.
2. **Card catalogue:**
   - ~40 cards: ~20 for your tank, ~20 for the team.
   - Rarities common / rare / epic / legendary, with the rare frames, synergy badges and build strip already built.
   - **Team cards:**
     - new tank cards: scout, gunner, heavy, **anti-tank** (long range, fragile), **support** (slowly repairs nearby allies);
     - extra squad slot, bigger squads (max 4), veteran crews, applique armor, field workshop;
     - combined arms (you and allies near each other reload faster), rally (Follow squads get armor), spotters (wider vision for fog of war), flag runners;
     - **artillery support** (legendary: a barrage callable from the tactical map).
   - **Tags:** escort, assault, defense, recon, gun, armor, crew. Draws favour owned tags (already implemented).
3. **Roster screen** between battles: list of tanks and squads with damage, so you can see what survived.
4. **Done when:** a full 7-battle run is playable and builds feel different from run to run.

### 13.5 B5: Biomes
- **Forest:** dense trees as **TRUNK** (solid wood) + **CANOPY** (overhead layer: hides units under it from the tactical map and enemy sight, flammable, rendered as foliage over tanks), trails, clearings. Forest fires as a major event.
- **Beach:** **SAND** floor (craters deepen easily, slows tanks a little), **WATER** (slows tanks strongly, fire makes steam, later electricity), dunes, concrete bunkers (new **CONCRETE** masonry), anti-tank obstacles.
- **Village:** the old room generator (halls/lanes/courtyard, 3/4 wall depth, indoor lighting, in git history before the B1 commit) adapted into a village of houses along streets.
- Each battle picks a biome. The final assault uses the Village or a fortified variant.

### 13.6 B6: Polish
- **Sound:** WebAudio synthesized shots, explosions, engines, fire crackle, UI clicks.
- **Readability:** team outlines at distance, minimap corner (optional), damage numbers off by default.
- **Performance:** spread chunk rendering over several frames on camera jumps and at battle start; precompute the worldgen noise on a coarse grid (generation currently ~0.5-0.8 s).
- **Balance:** card values, ally strength, wave sizes, capture time.

### 13.7 Testing approach
- `node tools/bench.mjs [ticks]` runs a headless battle with a bot (drives to the flag along the flow field, shoots the nearest enemy) and reports simulation and render cost.
- `node tools/snapshot.mjs out.png [ticks] [seed]` renders a frame of a bot-played battle to PNG.
- Mechanics are checked with headless scripts (armor/ricochet, crew, emergency, smoke vs line of sight, MG chip, wall collapse, telegraph). These scripts live outside the repo; add them under `tools/tests/` when convenient.

---

## 14. Open questions
- Exact squad size cap, and whether the player can merge or split squads.
- Should allies gain experience (veterancy) by surviving battles?
- Night battles (the lighting system already supports dark maps)?
