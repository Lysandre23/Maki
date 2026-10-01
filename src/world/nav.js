import { SOLID } from './materials.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const CACHE = 24;

// Coarse navigation grid + BFS flow fields.
// Many tanks share a few destinations (follow the player, hold a post, take
// the flag), so fields are cached per destination node (LRU) and dropped when
// the terrain changes (rebuildRegion).
export class Nav {
  constructor(grid, cell = 12) {
    this.c = cell;
    this.w = Math.ceil(grid.w / cell);
    this.h = Math.ceil(grid.h / cell);
    const n = this.w * this.h;
    this.blocked = new Uint8Array(n);
    this.pass = new Uint8Array(n);
    this.queue = new Int32Array(n);
    this.cache = new Map(); // node -> { dist, t }
    this.version = 0;
  }

  rebuild(grid) {
    this.rebuildRegion(grid, 0, 0, grid.w - 1, grid.h - 1);
  }

  // Recompute blocked/pass for the nodes covering a world rect.
  rebuildRegion(grid, x0, y0, x1, y1) {
    const { c, w, h, blocked, pass } = this;
    const gw = grid.w, mat = grid.mat;
    const ni0 = Math.max(0, Math.floor(x0 / c) - 1), ni1 = Math.min(w - 1, Math.floor(x1 / c) + 1);
    const nj0 = Math.max(0, Math.floor(y0 / c) - 1), nj1 = Math.min(h - 1, Math.floor(y1 / c) + 1);
    for (let nj = nj0; nj <= nj1; nj++) {
      for (let ni = ni0; ni <= ni1; ni++) {
        let b = 0;
        const bx = ni * c, by = nj * c;
        for (let y = by; y < by + c && y < grid.h && !b; y++) {
          const row = y * gw;
          for (let x = bx; x < bx + c && x < gw; x++) {
            if (SOLID[mat[row + x]]) { b = 1; break; }
          }
        }
        blocked[nj * w + ni] = b;
      }
    }
    // A tank needs clearance: node plus its 8 neighbours must be free.
    for (let nj = Math.max(0, nj0 - 1); nj <= Math.min(h - 1, nj1 + 1); nj++) {
      for (let ni = Math.max(0, ni0 - 1); ni <= Math.min(w - 1, ni1 + 1); ni++) {
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
    this.cache.clear();
    this.version++;
  }

  node(x, y) {
    const i = Math.max(0, Math.min(this.w - 1, Math.floor(x / this.c)));
    const j = Math.max(0, Math.min(this.h - 1, Math.floor(y / this.c)));
    return j * this.w + i;
  }

  // BFS distance field toward (x, y), cached. Returns Int32Array (-1 = unreachable).
  field(x, y) {
    const s = this.node(x, y);
    const hit = this.cache.get(s);
    if (hit) { this.cache.delete(s); this.cache.set(s, hit); return hit.dist; } // LRU touch
    const { w, h, pass, queue } = this;
    const dist = new Int32Array(w * h);
    dist.fill(-1);
    let head = 0, tail = 0;
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
    if (this.cache.size >= CACHE) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(s, { dist });
    return dist;
  }

  // Direction (radians) to walk from (x, y) down a distance field, or null.
  dirAt(dist, x, y) {
    const { c, w, h } = this;
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
