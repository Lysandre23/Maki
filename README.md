# MAKI

A top-down, black-and-white comic-book tank roguelike where every pixel is simulated: walls crumble cell by cell, smoke and fire flow as a fluid, oil spills and burns, ice coats floors and walls. You drive a tank built from separate parts through 10 rooms, and build elemental synergies from upgrade cards between rooms.

See [GAME_DESIGN.md](GAME_DESIGN.md) for the full design.

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
| 1-3 | Pick an upgrade card |
| R | New run (after death or victory) |
| P / Esc | Pause |
| F3 | Performance overlay |

## Tools

Headless (Node) helpers that run the simulation without a browser:

```
node tools/bench.mjs [ticks]            # performance of the full game loop
node tools/snapshot.mjs out.png [ticks]  # render a frame of a bot-played game to PNG
```
