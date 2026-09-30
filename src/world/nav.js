import { SOLID } from './materials.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// Coarse navigation grid + BFS flow field toward the player.
// Rebuilt when terrain changes (walls get destroyed, wrecks appear).
export class Nav {
  constructor(grid, cell = 8) {
    this.c = cell;
    this.w = Math.ceil(grid.w / cell);
    this.h = Math.ceil(grid.h / cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.pass = new Uint8Array(n);
    this.dist = new Int32Array(n).fill(-1);
    this.queue = new Int32Array(n);
    this.version = -1;
  }

  rebuild(grid) {
    const { c, w, h, blocked, pass } = this;
    const gw = grid.w, mat = grid.mat;
    for (let nj = 0; nj < h; nj++) {
      for (let ni = 0; ni < w; ni++) {
        let b = 0;
        const x0 = ni * c, y0 = nj * c;
        for (let y = y0; y < y0 + c && y < grid.h && !b; y++) {
          const row = y * gw;
          for (let x = x0; x < x0 + c && x < gw; x++) {
            if (SOLID[mat[row + x]]) { b = 1; break; }
          }
        }
        blocked[nj * w + ni] = b;
      }
    }
    // A tank needs clearance: node plus its 8 neighbours must be free.
    for (let nj = 0; nj < h; nj++) {
      for (let ni = 0; ni < w; ni++) {
        let ok = 1;
        for (let dj = -1; dj <= 1 && ok; dj++) {
          for (let di = -1; di <= 1; di++) {
            const i = ni + di, j = nj + dj;
            if (i < 0 || j < 0 || i >= w || j >= h || blocked[j * w + i]) { ok = 0; break; }
          }
        }
        pass[nj * w + ni] = ok;
      }
    }
    this.version = grid.version;
  }

  flow(x, y) {
    const { c, w, h, pass, dist, queue } = this;
    dist.fill(-1);
    const si = Math.max(0, Math.min(w - 1, Math.floor(x / c)));
    const sj = Math.max(0, Math.min(h - 1, Math.floor(y / c)));
    let head = 0, tail = 0;
    const s = sj * w + si;
    dist[s] = 0; queue[tail++] = s;
    while (head < tail) {
      const k = queue[head++];
      const i = k % w, j = (k / w) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
        if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
        const nk = nj * w + ni;
        if (dist[nk] >= 0 || !pass[nk]) continue;
        if (d >= 4 && (!pass[j * w + ni] || !pass[nj * w + i])) continue; // no corner cutting
        dist[nk] = dist[k] + 1;
        queue[tail++] = nk;
      }
    }
  }

  // Direction (radians) to walk from (x, y) toward the flow target, or null.
  dirAt(x, y) {
    const { c, w, h, dist } = this;
    const i = Math.floor(x / c), j = Math.floor(y / c);
    if (i < 0 || j < 0 || i >= w || j >= h) return null;
    const own = dist[j * w + i];
    if (own === 0) return null;
    let best = -1, bd = own >= 0 ? own : 1e9;
    for (let d = 0; d < 8; d++) {
      const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
      if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
      const nd = dist[nj * w + ni];
      if (nd >= 0 && nd < bd) { bd = nd; best = d; }
    }
    if (best < 0) return null;
    const tx = (i + DIRS[best][0] + 0.5) * c, ty = (j + DIRS[best][1] + 0.5) * c;
    return Math.atan2(ty - y, tx - x);
  }
}
