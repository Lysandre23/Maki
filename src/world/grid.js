import { CHUNK, CHUNK_SHIFT } from '../config.js';
import { MAT_HP, SOLID } from './materials.js';

const MAX_TOUCHED = 20000;

// Chunked cell grid, stored as flat typed arrays (struct-of-arrays).
export class Grid {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cw = Math.ceil(w / CHUNK);
    this.ch = Math.ceil(h / CHUNK);
    const n = w * h;
    this.mat = new Uint8Array(n);     // material id
    this.hp = new Uint8Array(n);      // remaining durability
    this.data = new Uint8Array(n);    // visual variant / barrel id
    this.floor = new Uint8Array(n);   // floor pattern id (tiles, cracks, track marks)
    this.scorch = new Uint8Array(n);  // 0 none, 1 light, 2 dark
    this.burn = new Uint8Array(n);    // fire life per burning cell
    this.light = new Uint8Array(n);   // baked ceiling lighting, 0..255
    this.frost = new Uint8Array(n);   // ice coating timer (x4 ticks), floor and walls
    this.brittle = 2;                 // blast damage multiplier on frozen masonry
    this.struct = new Uint16Array(n); // masonry structure id (wall segment, pillar)
    this.structSize = new Int32Array(1); // original cell count per structure id
    this.dirty = new Uint8Array(this.cw * this.ch).fill(1); // chunk needs full redraw
    this.touched = [];                // single cells to recolor (no shadow change)
    this.version = 0;                 // bumps whenever solidity changes (nav, gas)
  }

  // Shadows are cast down-right from solids (see render/palette.js), so a change
  // near a chunk's right/bottom edge also invalidates the neighbouring chunks.
  markDirty(x, y) {
    const cx = x >> CHUNK_SHIFT, cy = y >> CHUNK_SHIFT;
    const i = cy * this.cw + cx;
    this.dirty[i] = 1;
    const right = (x & (CHUNK - 1)) >= CHUNK - 5 && cx + 1 < this.cw;
    const down = (y & (CHUNK - 1)) >= CHUNK - 5 && cy + 1 < this.ch;
    if (right) this.dirty[i + 1] = 1;
    if (down) this.dirty[i + this.cw] = 1;
    if (right && down) this.dirty[i + this.cw + 1] = 1;
  }

  // Cheap invalidation for a single cell whose change can't affect shadows.
  touch(x, y) {
    if (this.touched.length < MAX_TOUCHED) this.touched.push(y * this.w + x);
    else this.markDirty(x, y);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  // Out-of-bounds counts as solid so nothing leaves the world.
  isSolid(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return true;
    return SOLID[this.mat[y * this.w + x]] === 1;
  }

  setCell(x, y, m, data = 0) {
    const i = y * this.w + x;
    const old = this.mat[i];
    this.mat[i] = m;
    this.hp[i] = MAT_HP[m];
    this.data[i] = data;
    if (SOLID[old] !== SOLID[m]) { this.markDirty(x, y); this.version++; }
    else this.touch(x, y);
  }
}
