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
- **Map:** large and horizontal, about 4 screens of area (target 2560x864 cells, camera 640x360). You spawn on the left edge, and the enemy flag is near the right edge.
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
- **World:** grid ~2560x864 (2.2 M cells, ~20 MB of typed arrays), 64x64 chunks, camera 640x360.
- **Gas solver:** limited to a window around the camera (e.g. 1.5 screens), frozen or dissipated outside it, so its cost stays at today's ~3 ms.
- **AI:** team-agnostic tank brain (target selection by team), with an **order layer** (move/attack/hold/follow + stance) on top and a **commander layer** for the enemy. Line-of-sight checks are staggered over ticks.
- **Navigation:** flow fields per order destination, cached and shared by squads with the same target.
- **Fog of war:** a per-team visibility grid at coarse resolution (e.g. 16-cell nodes), updated a few times per second.

---

## 13. Milestones
| # | Goal | Done when |
|---|---|---|
| **B1** | Remove the elements. New color rule (yellow HUD, orange fire, red/blue strokes). Wide map + **Field** biome (grass, hedges, hay). Team-agnostic AI with **allies**. **Flag capture**. | A battle can be won by capturing the flag with 4 allies at your side |
| B2 | **Tactical map**: pause, schematic view, squads, orders (Move/Attack/Hold/Follow), stances, fog of war | Orders visibly change how the battle unfolds |
| B3 | **Enemy**: defenses, reinforcement waves, commander AI; 5-minute pacing and balance | Battles last ~5 min and feel like a front line |
| B4 | **Cards v2** (player / team families, new-tank cards), roster persistence, 7-battle run | A full run is playable |
| B5 | **Biomes**: Forest, Beach, Village | Each battle picks a biome |
| B6 | Polish: sound, readability, balance | |

---

## 14. Open questions
- Exact squad size cap, and whether the player can merge or split squads.
- Should allies gain experience (veterancy) by surviving battles?
- Night battles (the lighting system already supports dark maps)?
