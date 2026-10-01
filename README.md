# MAKI

A top-down, black-and-white comic-book tank roguelike where every pixel is simulated: hedges and walls break cell by cell, grass and trees burn, smoke flows as a fluid, wrecks become cover. You lead a squad of tanks across wide battlefields to capture the enemy flag, in the strongest tank of your army.

See [GAME_DESIGN.md](GAME_DESIGN.md) for the full design and the roadmap (section 13).

**Status:** milestone B2 done (tactical map, squads, orders, stances, fog of war). Next: B3, enemy defenses, reinforcement waves and pacing.

## Run

Plain JavaScript (ES modules), no build step. Serve the folder with any static server:

```
python -m http.server 8080
```

Then open http://localhost:8080.

## Controls

| Input | Action |
|---|---|
| WASD / ZQSD / arrows | Drive |
| Mouse | Aim the turret |
| Left click | Cannon |
| Right click (hold) | Machine gun |
| Space | Smoke grenades |
| 1-7 / click a part | Send a mechanic to repair that part |
| E | Emergency patch |
| C | Engine power mode |
| 1-3 | Pick a reward card |
| R | New run (after defeat or victory) |
| Tab / M | Tactical map (pauses the battle) |
| O | Show / hide squad order arrows |
| P / Esc | Pause |
| F3 | Performance overlay |

On the tactical map:

| Input | Action |
|---|---|
| 1-4 / click | Select a squad |
| Right click | Move there (only stops to fight when hit or a foe is close) |
| Shift + right click | Attack there (engages everything on the way) |
| Ctrl + right click | Hold there (takes cover facing the nearest known enemy) |
| H / F | Hold here / Follow me |
| S | Stance: aggressive, or cautious (falls back to you below 40% hull) |
| Tab / M / Esc | Back to the battle |

**Goal:** reach the flag on the east side and hold its zone until it's captured. Your allies start in two squads following you, and the yellow arrow on the screen edge points to the flag.

The view fills the browser window: pixels are scaled by a whole number, and the visible area grows or shrinks to fit (up to 896x544 cells).

## Color code

The world is black and white. Colors carry meaning only: **yellow** HUD, **red** enemies, **blue** allies (bright blue + yellow pennant for you), **orange** fire.

## Tools

Headless (Node) helpers that run the simulation without a browser:

```
node tools/bench.mjs [ticks]                    # performance of a bot-played battle
node tools/snapshot.mjs out.png [ticks] [seed]  # render a frame of a bot-played battle to PNG
```
