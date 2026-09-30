// Headless performance run of the full game loop + frame composition (no DOM).
// Run: node tools/bench.mjs [ticks]
import { VIEW_W, VIEW_H } from '../src/config.js';
import { Composer } from '../src/render/compose.js';
import { makeGame, botInput } from './sim.mjs';

const TICKS = +(process.argv[2] || 1800);
const game = makeGame(777);
const composer = new Composer(game.grid);
const frame = new Uint32Array(VIEW_W * VIEW_H);

let upd = 0, updMax = 0, comp = 0, compMax = 0, rooms = 1;
for (let i = 0; i < TICKS; i++) {
  if (game.state === 'reward') { game.chooseReward(0); rooms++; }
  if (game.state === 'dead') { console.log(`player died at tick ${i} in room ${game.level}`); game.newRun(); }
  let t0 = performance.now();
  game.update(botInput(game));
  let dt = performance.now() - t0;
  upd += dt; updMax = Math.max(updMax, dt);
  t0 = performance.now();
  composer.compose(game, frame, Math.round(game.cam.x), Math.round(game.cam.y));
  dt = performance.now() - t0;
  comp += dt; compMax = Math.max(compMax, dt);
}
console.log(`ticks ${TICKS}, rooms visited ${rooms}, kills ${game.kills}`);
console.log(`update  avg ${(upd / TICKS).toFixed(2)} ms  worst ${updMax.toFixed(2)} ms`);
console.log(`compose avg ${(comp / TICKS).toFixed(2)} ms  worst ${compMax.toFixed(2)} ms   (budget 16.6 ms/frame)`);
