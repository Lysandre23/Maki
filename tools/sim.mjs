// Shared headless driver: a scripted "bot" plays the player tank.
import { Game } from '../src/game/game.js';

export function makeGame(seed = 12345) {
  return new Game(seed);
}

// Drive toward the nearest enemy, aim and fire at it.
export function botInput(game) {
  const p = game.player;
  let best = null, bd = Infinity;
  for (const e of game.enemies) {
    if (!e.alive) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) return { throttle: 0, turn: 0, aimX: p.x + 100, aimY: p.y, fire: false };
  const want = Math.atan2(best.y - p.y, best.x - p.x);
  let d = want - p.a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const far = bd > 140 * 140;
  return {
    throttle: far && Math.abs(d) < 0.8 ? 1 : 0,
    turn: far ? Math.max(-1, Math.min(1, d * 2)) : 0,
    aimX: best.x, aimY: best.y,
    fire: true,
  };
}
