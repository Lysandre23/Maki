import { M, FLAMMABLE, SOLID } from './materials.js';

// Ice coating on floor and walls. grid.frost holds a timer (decremented every
// 4 ticks). Frozen floor is slippery, frozen masonry is brittle (blasts do
// grid.brittle x damage), frozen oil stops flowing and can't burn.
// Heat melts ice into steam; freezing puts fires out.
export class Frost {
  constructor() {
    this.list = [];
  }

  clear(grid) {
    this.list.length = 0;
    grid.frost.fill(0);
  }

  // strength ~1: a normal cryo shell. duration multiplies how long it lasts.
  freeze(grid, gas, flames, x, y, r, strength = 1, duration = 1) {
    const { w, frost, burn, mat } = grid;
    const r2 = r * r;
    for (let yy = Math.max(0, Math.floor(y - r)); yy <= Math.min(grid.h - 1, y + r); yy++) {
      for (let xx = Math.max(0, Math.floor(x - r)); xx <= Math.min(w - 1, x + r); xx++) {
        const d2 = (xx + 0.5 - x) ** 2 + (yy + 0.5 - y) ** 2;
        if (d2 > r2) continue;
        const f = 1 - Math.sqrt(d2) / r;
        if (f < 0.15 && Math.random() > f * 5) continue; // ragged rim
        const i = yy * w + xx;
        const m = mat[i];
        if (m === M.WOOD || m === M.BARREL) continue; // stays dry
        const v = Math.min(255, Math.round((60 + 180 * f) * strength * duration));
        if (v > frost[i]) {
          if (!frost[i]) this.list.push(i);
          frost[i] = v;
          if (SOLID[m]) grid.markDirty(xx, yy); else grid.touch(xx, yy);
        }
        if (burn[i] && FLAMMABLE[m]) { burn[i] = 1; } // snuffed out next fire tick
      }
    }
    gas.chill(x, y, r);
  }

  step(grid, gas) {
    const { w, frost, mat } = grid;
    const list = this.list;
    for (let k = list.length - 1; k >= 0; k--) {
      const i = list[k];
      const x = i % w, y = (i / w) | 0;
      let v = frost[i];
      if (v && gas.heatAt(x, y) > 0.35) { // melts into steam
        if (Math.random() < 0.08) gas.addSteam(x, y, 0.15);
        v = 0;
      } else if (v) v--;
      if (v === 0 || (mat[i] !== M.EMPTY && mat[i] !== M.OIL && !SOLID[mat[i]] && mat[i] !== M.RUBBLE)) {
        frost[i] = 0;
        list[k] = list[list.length - 1]; list.pop();
        if (SOLID[mat[i]]) grid.markDirty(x, y); else grid.touch(x, y);
        continue;
      }
      if ((frost[i] > 60) !== (v > 60)) grid.touch(x, y); // thick/thin ice look
      frost[i] = v;
    }
  }
}
