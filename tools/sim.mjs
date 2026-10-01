// Shared headless driver: a scripted "bot" plays the player tank.
import { Game } from '../src/game/game.js';

export function makeGame(seed = 12345) {
  return new Game(seed);
}

// Push toward the flag along the nav flow field, shoot the nearest enemy in range.
export function botInput(game) {
  const p = game.player;
  let best = null, bd = Infinity;
  for (const e of game.enemies) {
    if (!e.alive) continue;
    const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  const f = game.flag;
  let want = Math.atan2(f.y - p.y, f.x - p.x);
  if (game.nav) {
    const dir = game.nav.dirAt(game.nav.field(f.x, f.y), p.x, p.y);
    if (dir !== null) want = dir;
  }
  let d = want - p.a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const atFlag = Math.hypot(f.x - p.x, f.y - p.y) < f.r * 0.5;
  const engage = best && bd < 380 * 380;
  return {
    throttle: !atFlag && Math.abs(d) < 0.8 ? (engage && bd < 200 * 200 ? 0.3 : 1) : 0,
    turn: atFlag ? 0 : Math.max(-1, Math.min(1, d * 2)),
    aimX: engage ? best.x : p.x + Math.cos(p.a) * 100, aimY: engage ? best.y : p.y + Math.sin(p.a) * 100,
    fire: !!engage,
  };
}
