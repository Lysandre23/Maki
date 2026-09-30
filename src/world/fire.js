import { rnd } from '../util/rng.js';
import { M, FLAMMABLE } from './materials.js';

// Cell-based fire. Burning cells heat the gas field (which renders the flames
// and turns into smoke), spread to nearby flammables, set off barrels, and
// finally burn away leaving a scorch mark.
//  - wood: burns long, spreads slowly (sparks jump up to 2 cells)
//  - oil:  burns fast and hot, the fire front races across the slick
// Ice snuffs fires out. lifeMult / spreadMult / oilHeat are driven by upgrades.
export class Fire {
  constructor() {
    this.list = [];
    this.lifeMult = 1;
    this.spreadMult = 1;
    this.oilHeat = 1;
  }

  clear(grid) {
    this.list.length = 0;
    grid.burn.fill(0);
  }

  ignite(grid, x, y) {
    if (!grid.inBounds(x, y)) return;
    const i = y * grid.w + x;
    const m = grid.mat[i];
    if (!FLAMMABLE[m] || grid.burn[i] || grid.frost[i]) return;
    const base = m === M.OIL ? 40 + rnd() * 40 : 120 + rnd() * 120;
    grid.burn[i] = Math.min(255, Math.max(2, Math.round(base * this.lifeMult)));
    this.list.push(i);
  }

  step(grid, gas, onBarrel) {
    const { w, mat, burn, data, frost } = grid;
    const list = this.list;
    for (let k = list.length - 1; k >= 0; k--) {
      const i = list[k];
      const m = mat[i];
      if (!FLAMMABLE[m] || frost[i]) { // blown away or frozen
        burn[i] = 0;
        if (frost[i]) gas.addSteam(i % w, (i / w) | 0, 0.05);
        list[k] = list[list.length - 1]; list.pop();
        continue;
      }
      const x = i % w, y = (i / w) | 0;
      const oil = m === M.OIL;
      gas.addHeat(x, y, oil ? 0.07 * this.oilHeat : 0.06);
      if (rnd() < 0.5) gas.addSmoke(x, y, oil ? 0.09 : 0.06);
      if (rnd() < 0.02) gas.addExpand(x, y, 0.05);

      const reach = oil ? 1 : 2;
      if (rnd() < (oil ? 0.35 : 0.08) * this.spreadMult) {
        const nx = x + ((rnd() * (2 * reach + 1)) | 0) - reach, ny = y + ((rnd() * (2 * reach + 1)) | 0) - reach;
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
