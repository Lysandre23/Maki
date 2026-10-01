# MAKI

A top-down, black-and-white comic-book tank roguelike where every pixel is simulated: hedges and walls break cell by cell, grass and trees burn, smoke flows as a fluid, wrecks become cover. You lead a squad of tanks across wide battlefields to capture the enemy flag, in the strongest tank of your army.

See [GAME_DESIGN.md](GAME_DESIGN.md) for the full design and the roadmap (section 13).

**Status:** milestone B1 done (Field battlefield, allies, flag capture). Next: B2, the tactical map with squad orders.

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
| P / Esc | Pause |
| F3 | Performance overlay |

**Goal:** reach the flag on the east side and hold its zone until it's captured. Your allies follow you, and the yellow arrow on the screen edge points to the flag.

## Color code

The world is black and white. Colors carry meaning only: **yellow** HUD, **red** enemies, **blue** allies (bright blue + yellow pennant for you), **orange** fire.

## Tools

Headless (Node) helpers that run the simulation without a browser:

```
node tools/bench.mjs [ticks]                    # performance of a bot-played battle
node tools/snapshot.mjs out.png [ticks] [seed]  # render a frame of a bot-played battle to PNG
```
