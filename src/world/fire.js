import { rnd, hash } from '../util/rng.js';
import { M, FLAMMABLE } from './materials.js';

// Cell-based fire. Burning cells heat the gas field (which renders the flames
// and turns into smoke), spread to nearby flammables, set off fuel drums, and
// finally burn away leaving a scorch mark.
//   grass: flashes over in a few seconds, the front races across a field
//   hedge / hay: burn a while, throw fire to neighbours
//   wood: burns long, spreads slowly
const LIFE = { [M.GRASS]: [18, 22], [M.HEDGE]: [80, 80], [M.HAY]: [110, 90], [M.WOOD]: [120, 120] };
const SPREAD = { [M.GRASS]: 0.2, [M.HEDGE]: 0.14, [M.HAY]: 0.18, [M.WOOD]: 0.08 };
const HEAT = { [M.GRASS]: 0.035, [M.HEDGE]: 0.06, [M.HAY]: 0.07, [M.WOOD]: 0.06 };

export class Fire {
  constructor() {
    this.list = [];
    this.lifeMult = 1;
    this.spreadMult = 1;
  }

  clear(grid) {
    this.list.length = 0;
    grid.burn.fill(0);
  }

  ignite(grid, x, y) {
    if (!grid.inBounds(x, y)) return;
    const i = y * grid.w + x;
    const m = grid.mat[i];
    if (!FLAMMABLE[m] || grid.burn[i]) return;
    // some grass is green/damp and won't catch: fires stall in patchy meadows
    if (m === M.GRASS && hash(x, y) % 10 < 4) return;
    const [a, b] = LIFE[m];
    grid.burn[i] = Math.min(255, Math.max(2, Math.round((a + rnd() * b) * this.lifeMult)));
    this.list.push(i);
  }

  step(grid, gas, onBarrel) {
    const { w, mat, burn, data } = grid;
    const list = this.list;
    for (let k = list.length - 1; k >= 0; k--) {
      const i = list[k];
      const m = mat[i];
      if (!FLAMMABLE[m]) { // blown away
        burn[i] = 0;
        list[k] = list[list.length - 1]; list.pop();
        continue;
      }
      const x = i % w, y = (i / w) | 0;
      gas.addHeat(x, y, HEAT[m]);
      if (rnd() < 0.5) gas.addSmoke(x, y, m === M.GRASS ? 0.04 : 0.06);
      if (rnd() < 0.02) gas.addExpand(x, y, 0.05);

      // radiant heat jumps small gaps (up to 2 cells)
      if (rnd() < SPREAD[m] * this.spreadMult) {
        const nx = x + ((rnd() * 5) | 0) - 2, ny = y + ((rnd() * 5) | 0) - 2;
        if (grid.inBounds(nx, ny)) {
          const j = ny * w + nx;
          if (FLAMMABLE[mat[j]]) this.ignite(grid, nx, ny);
          else if (mat[j] === M.BARREL) onBarrel(data[j]);
        }
      }

      if (rnd() < 0.5 && --burn[i] === 0) {
        grid.setCell(x, y, M.EMPTY);
        grid.scorch[i] = 2;
        list[k] = list[list.length - 1]; list.pop();
      }
    }
  }
}
