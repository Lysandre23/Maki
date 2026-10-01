import { hash } from '../util/rng.js';
import { M, FLAMMABLE } from './materials.js';

const DAMP = 0.93;
const SPARK_DAMP = 0.96;
const REST_SPEED2 = 0.02;
const NEIGHBORS = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]];

// Free-flying particles in flat typed arrays.
// Top-down view: no gravity. Debris gets an outward blast impulse, slides with
// damping, bounces off solids, then settles back into the grid as RUBBLE.
// SPARK: short-lived, ignores walls. EMBER: bounces, ignites what it touches (grass underneath too), burns out.
export class Debris {
  constructor(max) {
    this.max = max;
    this.n = 0;
    this.x = new Float32Array(max);
    this.y = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.m = new Uint8Array(max);
    this.life = new Int16Array(max); // -1 = until settled
  }

  spawn(x, y, vx, vy, m, life = -1) {
    if (this.n >= this.max) return false;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.m[i] = m; this.life[i] = life;
    return true;
  }

  remove(i) {
    const l = --this.n;
    if (i !== l) {
      this.x[i] = this.x[l]; this.y[i] = this.y[l];
      this.vx[i] = this.vx[l]; this.vy[i] = this.vy[l];
      this.m[i] = this.m[l]; this.life[i] = this.life[l];
    }
  }

  clear() { this.n = 0; }

  settle(grid, i, hooks) {
    const cx = Math.floor(this.x[i]), cy = Math.floor(this.y[i]);
    for (const [ox, oy] of NEIGHBORS) {
      const x = cx + ox, y = cy + oy;
      if (grid.inBounds(x, y) && grid.mat[y * grid.w + x] === M.EMPTY) {
        grid.setCell(x, y, M.RUBBLE, hash(x, y) % 3);
        return;
      }
    }
  }

  // Particles outside the active rect are fast-forwarded (settled in place),
  // so far-away explosions cost almost nothing.
  update(grid, ax0, ay0, ax1, ay1, hooks) {
    const { x, y, vx, vy, m, life } = this;
    for (let i = this.n - 1; i >= 0; i--) {
      const px = x[i], py = y[i];
      const mi = m[i];
      const outside = px < ax0 || px > ax1 || py < ay0 || py > ay1;

      if (mi === M.SPARK) {
        if (--life[i] <= 0 || outside) { this.remove(i); continue; }
        vx[i] *= SPARK_DAMP; vy[i] *= SPARK_DAMP;
        x[i] = px + vx[i]; y[i] = py + vy[i];
        continue;
      }

      if (outside) {
        if (mi !== M.EMBER) this.settle(grid, i, hooks);
        this.remove(i);
        continue;
      }

      let dx = vx[i] * DAMP, dy = vy[i] * DAMP;
      let nx = px + dx, ny = py + dy;
      let cx = Math.floor(nx), cy = Math.floor(py);
      if (grid.isSolid(cx, cy)) {
        if (mi === M.EMBER && hooks && grid.inBounds(cx, cy) && FLAMMABLE[grid.mat[cy * grid.w + cx]]) hooks.ignite(cx, cy);
        dx = -dx * 0.4; nx = px;
      }
      cx = Math.floor(nx); cy = Math.floor(ny);
      if (grid.isSolid(cx, cy)) {
        if (mi === M.EMBER && hooks && grid.inBounds(cx, cy) && FLAMMABLE[grid.mat[cy * grid.w + cx]]) hooks.ignite(cx, cy);
        dy = -dy * 0.4; ny = py;
      }
      vx[i] = dx; vy[i] = dy;
      x[i] = nx; y[i] = ny;

      if (mi === M.EMBER) {
        // embers light up the grass they fly over
        const ex = Math.floor(nx), ey = Math.floor(ny);
        if (hooks && grid.inBounds(ex, ey) && grid.mat[ey * grid.w + ex] === M.GRASS && (i & 3) === 0) hooks.ignite(ex, ey);
        if (--life[i] <= 0) this.remove(i);
        continue;
      }
      if (dx * dx + dy * dy < REST_SPEED2) {
        this.settle(grid, i, hooks);
        this.remove(i);
      }
    }
  }
}
