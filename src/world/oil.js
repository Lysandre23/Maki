import { M } from './materials.js';

const DIRS = [1, -1, 0, 0];

// Oil is a liquid layer on the floor: each OIL cell stores its depth in
// grid.data (1..8). Deep cells spill into neighbours until the slick is a thin
// film, so a splash spreads out, pools in craters and runs under tanks.
// It burns (FLAMMABLE) and freezes (no flow while frosted).
export class Oil {
  constructor() {
    this.active = [];
  }

  clear() {
    this.active.length = 0;
  }

  add(grid, x, y, amount) {
    if (!grid.inBounds(x, y)) return;
    const i = y * grid.w + x;
    const m = grid.mat[i];
    if (m === M.EMPTY) grid.setCell(x, y, M.OIL, Math.min(8, amount));
    else if (m === M.OIL) { grid.data[i] = Math.min(8, grid.data[i] + amount); grid.touch(x, y); }
    else return;
    if (grid.data[i] > 1) this.active.push(i);
  }

  // Blob of oil, deeper in the middle.
  splash(grid, x, y, r, depth = 4) {
    for (let yy = Math.floor(y - r); yy <= y + r; yy++) {
      for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
        const d = Math.hypot(xx + 0.5 - x, yy + 0.5 - y) / r;
        if (d > 1) continue;
        this.add(grid, xx, yy, Math.max(2, Math.round(depth * (1 - d * 0.6))));
      }
    }
  }

  step(grid) {
    const { w, mat, data, frost } = grid;
    const cur = this.active;
    const next = [];
    for (let n = 0; n < cur.length; n++) {
      const i = cur[n];
      if (mat[i] !== M.OIL || frost[i] || data[i] <= 1) continue;
      const x = i % w, y = (i / w) | 0;
      const r = (Math.random() * 4) | 0;
      let moved = 0;
      for (let k = 0; k < 4 && data[i] > 1 && moved < 2; k++) {
        const d = (r + k) & 3;
        const nx = x + DIRS[d], ny = y + DIRS[(d + 2) & 3];
        if (!grid.inBounds(nx, ny)) continue;
        const j = ny * w + nx;
        // floor roughness: some cells resist, so spills grow ragged fingers
        if (mat[j] === M.EMPTY && ((nx * 73856093) ^ (ny * 19349663)) % 7 !== 0) {
          grid.setCell(nx, ny, M.OIL, 1);
          data[i]--;
        } else if (mat[j] === M.OIL && !frost[j] && data[j] < data[i] - 1) {
          data[j]++; data[i]--;
          grid.touch(nx, ny);
          if (data[j] > 1) next.push(j);
        } else continue;
        grid.touch(x, y);
        moved++;
      }
      if (data[i] > 1) next.push(i);
    }
    this.active = next;
  }
}
