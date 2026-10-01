import { rnd } from '../util/rng.js';
import { M, DEBRIS_CHANCE } from './materials.js';

// Carve a crater: damage cells by distance falloff, turn destroyed cells into
// debris particles, scorch the floor, emit sparks. Returns number of destroyed cells.
// hooks (optional): { onBarrel(id), ignite(x, y) }
export function explode(grid, debris, x, y, r, power, hooks) {
  const { w, h, mat, hp, data, scorch } = grid;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(w - 1, Math.ceil(x + r));
  const y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(h - 1, Math.ceil(y + r));
  let destroyed = 0;

  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const i = yy * w + xx;
      const m = mat[i];
      if (m === M.EMPTY) continue;

      const d = Math.sqrt(d2);
      const f = 1 - d / r;
      const dmg = power * f * (0.75 + rnd() * 0.5);

      if (dmg >= hp[i]) {
        if (m === M.BARREL && hooks) hooks.onBarrel(data[i]);
        mat[i] = M.EMPTY; hp[i] = 0; data[i] = 0;
        grid.markDirty(xx, yy);
        grid.navTouch(xx, yy);
        destroyed++;
        let ux, uy;
        if (d < 0.5) { const a = rnd() * 6.2832; ux = Math.cos(a); uy = Math.sin(a); }
        else { ux = dx / d; uy = dy / d; }
        const speed = (0.5 + f * 2.2) * (0.6 + rnd() * 0.8);
        if (rnd() < DEBRIS_CHANCE[m]) {
          debris.spawn(xx + 0.5, yy + 0.5,
            ux * speed + (rnd() - 0.5) * 0.4, uy * speed + (rnd() - 0.5) * 0.4, m);
        }
        if (m === M.WOOD && rnd() < 0.3) {
          debris.spawn(xx + 0.5, yy + 0.5, ux * speed * 1.3, uy * speed * 1.3, M.EMBER, 40 + ((rnd() * 50) | 0));
        }
      } else if (dmg >= 1) {
        hp[i] -= dmg | 0;
        grid.markDirty(xx, yy);
        if (m === M.WOOD && hooks && rnd() < 0.35) hooks.ignite(xx, yy);
      }
    }
  }
  if (destroyed) grid.version++;

  // Floor scorch on bare cells (dithered, ragged falloff)
  const sr = r * 1.15, sr2 = sr * sr;
  const sx0 = Math.max(0, Math.floor(x - sr)), sx1 = Math.min(w - 1, Math.ceil(x + sr));
  const sy0 = Math.max(0, Math.floor(y - sr)), sy1 = Math.min(h - 1, Math.ceil(y + sr));
  for (let yy = sy0; yy <= sy1; yy++) {
    for (let xx = sx0; xx <= sx1; xx++) {
      const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > sr2) continue;
      const i = yy * w + xx;
      if (mat[i] !== M.EMPTY) continue;
      const n = 1 - Math.sqrt(d2) / sr + (rnd() - 0.5) * 0.45;
      const lvl = n > 0.5 ? 2 : n > 0.12 ? 1 : 0;
      if (lvl > scorch[i]) { scorch[i] = lvl; grid.markDirty(xx, yy); }
    }
  }

  // Sparks
  const sparks = (r * 1.2) | 0;
  for (let k = 0; k < sparks; k++) {
    const a = rnd() * 6.2832;
    const s = 1 + rnd() * 3.5;
    debris.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, M.SPARK, 15 + ((rnd() * 25) | 0));
  }

  return destroyed;
}
