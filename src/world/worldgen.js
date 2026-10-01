import { hash } from '../util/rng.js';
import { M } from './materials.js';
import { Nav } from './nav.js';

// Floor ids (colored by render/palette.js). Tile ids are for indoor biomes.
export const F = {
  TILE_A: 0, TILE_B: 1, LINE: 2, DOT: 3, CRACK: 4, TRACK: 5,
  GROUND: 6, GROUND2: 7, FURROW: 8, ROAD: 9, RUT: 10, FLAT: 11, PEBBLE: 12,
};

// Current masonry structure id, stamped into grid.struct (see world/collapse.js).
let SID = 0;
const BORDER = 8;

// ------------------------------------------------------------------ helpers

function brickCell(g, x, y) {
  const row = Math.floor(y / 4);
  const off = (row & 1) * 5;
  const mortar = (y & 3) === 3 || (x + off) % 10 === 9;
  const shade = mortar ? 0 : 1 + (hash(Math.floor((x + off) / 10), row) % 3);
  g.setCell(x, y, M.BRICK, shade);
  g.struct[y * g.w + x] = SID;
}

function stoneCell(g, x, y) {
  const mortar = x % 6 === 5 || y % 6 === 5;
  g.setCell(x, y, M.STONE, mortar ? 0 : 1 + (hash(Math.floor(x / 6), Math.floor(y / 6)) % 3));
  g.struct[y * g.w + x] = SID;
}

function fillRect(g, x, y, w, h, fn, avoid) {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      if (g.inBounds(xx, yy) && !(avoid && avoid(xx, yy))) fn(g, xx, yy);
    }
  }
}

function areaFree(g, x, y, w, h, pad = 0) {
  for (let yy = y - pad; yy < y + h + pad; yy += 2) {
    for (let xx = x - pad; xx < x + w + pad; xx += 2) {
      if (g.isSolid(xx, yy)) return false;
    }
  }
  return true;
}

// Smooth value noise in [0, 1], two octaves.
function noise(x, y, scale, seed) {
  const oct = (sc, sd) => {
    const fx = x / sc, fy = y / sc;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    let tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const r = (i, j) => (hash(i + sd * 131, j - sd * 71) & 1023) / 1023;
    const a = r(x0, y0) + (r(x0 + 1, y0) - r(x0, y0)) * tx;
    const b = r(x0, y0 + 1) + (r(x0 + 1, y0 + 1) - r(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  return oct(scale, seed) * 0.7 + oct(scale / 2.7, seed + 17) * 0.3;
}

function disc(g, cx, cy, r, fn, ragged = 0, seed = 0) {
  for (let y = Math.floor(cy - r - ragged); y <= cy + r + ragged; y++) {
    for (let x = Math.floor(cx - r - ragged); x <= cx + r + ragged; x++) {
      const a = Math.atan2(y - cy, x - cx);
      const rr = r + (ragged ? (hash(Math.round(a * 6) + seed, seed) % 100) / 100 * ragged : 0);
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= rr * rr && g.inBounds(x, y)) fn(g, x, y);
    }
  }
}

const hedgeCell = (g, x, y) => {
  if (g.mat[y * g.w + x] === M.EMPTY || g.mat[y * g.w + x] === M.GRASS) g.setCell(x, y, M.HEDGE);
};

function crate(g, x, y) {
  for (let ly = 0; ly < 10; ly++) {
    for (let lx = 0; lx < 10; lx++) {
      const d = lx === 0 || ly === 0 || lx === 9 || ly === 9 ? 0 : ly % 3 === 0 ? 1 : 2;
      g.setCell(x + lx, y + ly, M.WOOD, d);
    }
  }
}

// Baked light: full daylight with drifting cloud shadows (halftone).
function bakeDaylight(g, seed) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const n = noise(x, y, 260, seed);
      g.light[y * g.w + x] = n < 0.55 ? 255 : Math.max(110, 255 - (n - 0.55) * 900) | 0;
    }
  }
}

function clearLine(g, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 3);
  for (let k = 1; k < n; k++) {
    if (g.isSolid(Math.floor(x0 + ((x1 - x0) * k) / n), Math.floor(y0 + ((y1 - y0) * k) / n))) return false;
  }
  return true;
}

// ------------------------------------------------------------------ field

// Farmhouse: brick walls with a doorway on each long side.
function farmhouse(g, x, y, w, h, rng, avoid) {
  SID++;
  const T = 8;
  const d1 = x + 12 + Math.floor(rng() * (w - 60)), d2 = x + 12 + Math.floor(rng() * (w - 60));
  for (let xx = x; xx < x + w; xx++) {
    if (xx < d1 || xx >= d1 + 34) fillRect(g, xx, y, 1, T, brickCell, avoid);
    if (xx < d2 || xx >= d2 + 34) fillRect(g, xx, y + h - T, 1, T, brickCell, avoid);
  }
  fillRect(g, x, y, T, h, brickCell, avoid);
  fillRect(g, x + w - T, y, T, h, brickCell, avoid);
}

function roster(level, rng) {
  const n = 5 + level;
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (level <= 2) out.push(r < 0.45 ? 'scout' : r < 0.9 ? 'gunner' : 'heavy');
    else out.push(r < 0.3 ? 'scout' : r < 0.7 ? 'gunner' : 'heavy');
  }
  if (level >= 7) out[0] = 'boss';
  return out;
}

const SIZE = { scout: 22, gunner: 26, heavy: 30, boss: 40 };

// Defenders take spots in the enemy half: reachable, covered from the
// player's approach (hedges!), spread out; a few guard the flag.
function placeEnemies(g, rng, spawn, flag, types) {
  const W = g.w, H = g.h;
  const nav = new Nav(g, 12);
  nav.rebuild(g);
  const dist = nav.field(spawn.x, spawn.y);
  const cands = [];
  for (let y = 50; y < H - 50; y += 20) {
    for (let x = Math.round(W * 0.42); x < W - 50; x += 20) {
      if (!areaFree(g, x - 24, y - 24, 48, 48)) continue;
      if (dist[Math.floor(y / nav.c) * nav.w + Math.floor(x / nav.c)] < 0) continue;
      let cover = 0;
      for (let s = 20; s <= 80; s += 4) {
        if (g.isSolid(x - s, y)) { cover = 2; break; } // something between us and the west
      }
      const toFlag = Math.hypot(x - flag.x, y - flag.y);
      cands.push({ x, y, base: cover + (toFlag < 260 ? 1.5 : 0) + x / W });
    }
  }
  const out = [];
  for (const type of types) {
    const s = SIZE[type];
    let best = null, bs = -Infinity;
    for (let relax = 0; relax < 2 && !best; relax++) {
      const minD = relax ? 70 : 130;
      for (const c of cands) {
        if (!areaFree(g, Math.floor(c.x - s), Math.floor(c.y - s), 2 * s, 2 * s)) continue;
        if (out.some((e) => (e.x - c.x) ** 2 + (e.y - c.y) ** 2 < minD * minD)) continue;
        const sc = c.base + (type === 'boss' ? 3 - Math.hypot(c.x - flag.x, c.y - flag.y) / 150 : 0) + rng() * 2;
        if (sc > bs) { bs = sc; best = c; }
      }
    }
    if (best) out.push({ type, x: best.x, y: best.y, a: Math.PI });
  }
  return out;
}

// Builds a Field battlefield into the grid: farmland crossed by a dirt road,
// hedgerows (bocage) cutting it into fields with gaps, copses of trees, hay
// bales, a farm or two, old shell craters. Player enters west, flag is east.
export function generateBattle(g, rng, level) {
  g.mat.fill(0); g.hp.fill(0); g.data.fill(0); g.scorch.fill(0); g.burn.fill(0);
  g.struct.fill(0);
  SID = 1;
  const W = g.w, H = g.h;
  const seed = Math.floor(rng() * 10000);

  const spawn = { x: 110, y: Math.round(H / 2 + (rng() - 0.5) * 200) };
  const flag = { x: W - 200, y: Math.round(H / 2 + (rng() - 0.5) * 360) };
  const avoid = (x, y) => (x - spawn.x) ** 2 + (y - spawn.y) ** 2 < 130 * 130 ||
    (x - flag.x) ** 2 + (y - flag.y) ** 2 < 90 * 90;

  // --- ground: soil patches, a winding road, plowed fields
  const roadY = (x) => spawn.y + (flag.y - spawn.y) * (x / W) + Math.sin(x * 0.004 + seed) * 70;
  const fields = [];
  for (let k = 0; k < 7; k++) {
    const fw = 160 + rng() * 220, fh = 110 + rng() * 170;
    fields.push({ x: 220 + rng() * (W - 500), y: rng() * (H - fh), w: fw, h: fh, horiz: rng() < 0.5 });
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const ry = Math.abs(y - roadY(x));
      let f;
      if (ry < 13) f = Math.abs(ry - 6) < 1.5 ? F.RUT : F.ROAD;
      else {
        f = noise(x, y, 90, seed) > 0.5 ? F.GROUND2 : F.GROUND;
        for (const fl of fields) {
          if (x >= fl.x && x < fl.x + fl.w && y >= fl.y && y < fl.y + fl.h) {
            f = ((fl.horiz ? y : x) % 5 === 0) ? F.FURROW : F.GROUND2;
            break;
          }
        }
        if (hash(x, y) % 211 === 0) f = F.PEBBLE;
      }
      g.floor[i] = f;
      // meadows of tall grass away from the road and the plowed fields
      if (f !== F.ROAD && f !== F.RUT && f !== F.FURROW && noise(x, y, 150, seed + 5) > 0.5) g.mat[i] = M.GRASS;
    }
  }

  // --- border (low stone field walls)
  fillRect(g, 0, 0, W, BORDER, stoneCell);
  fillRect(g, 0, H - BORDER, W, BORDER, stoneCell);
  fillRect(g, 0, 0, BORDER, H, stoneCell);
  fillRect(g, W - BORDER, 0, BORDER, H, stoneCell);

  // --- bocage: north-south hedgerows with gaps, plus east-west stubs
  const onRoad = (x, y) => Math.abs(y - roadY(x)) < 16;
  const cols = [];
  for (let cx = 460; cx < W - 360; cx += 380 + Math.floor(rng() * 120)) cols.push(cx);
  for (const x0 of cols) {
    const gaps = [];
    const n = 2 + (rng() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) { const gy = 40 + Math.floor(rng() * (H - 160)); gaps.push([gy, gy + 70 + Math.floor(rng() * 40)]); }
    const ph = rng() * 6;
    for (let y = BORDER; y < H - BORDER; y++) {
      if (gaps.some(([a, b]) => y >= a && y < b)) continue;
      const cx = x0 + Math.sin(y * 0.021 + ph) * 9;
      const ht = 5 + (hash(x0, y >> 3) % 4);
      for (let x = Math.floor(cx - ht); x <= cx + ht; x++) {
        if (!onRoad(x, y) && !avoid(x, y)) hedgeCell(g, x, y);
      }
    }
  }
  for (let k = 0; k < cols.length * 2; k++) {
    const i = Math.floor(rng() * (cols.length + 1));
    const xa = i === 0 ? 220 : cols[i - 1] + 10, xb = i === cols.length ? W - 260 : cols[i] - 10;
    const y0 = 60 + Math.floor(rng() * (H - 120));
    const len = Math.min(xb - xa, 120 + Math.floor(rng() * 200));
    const xs = xa + Math.floor(rng() * Math.max(1, xb - xa - len));
    const ph = rng() * 6;
    for (let x = xs; x < xs + len; x++) {
      const cy = y0 + Math.sin(x * 0.03 + ph) * 6;
      for (let y = Math.floor(cy - 5); y <= cy + 5; y++) if (!onRoad(x, y) && !avoid(x, y)) hedgeCell(g, x, y);
    }
  }

  // --- copses and lone trees (crowns = foliage discs)
  const nCopses = 5 + Math.floor(rng() * 4);
  for (let k = 0; k < nCopses; k++) {
    const cx = 260 + rng() * (W - 520), cy = 50 + rng() * (H - 100);
    const nt = 3 + Math.floor(rng() * 6);
    for (let t = 0; t < nt; t++) {
      const x = cx + (rng() - 0.5) * 90, y = cy + (rng() - 0.5) * 70;
      if (!onRoad(x, y) && !avoid(x, y)) disc(g, x, y, 7 + rng() * 8, hedgeCell, 3, k * 31 + t);
    }
  }
  for (let k = 0; k < 14; k++) {
    const x = 240 + rng() * (W - 480), y = 40 + rng() * (H - 80);
    if (!onRoad(x, y) && !avoid(x, y)) disc(g, x, y, 6 + rng() * 5, hedgeCell, 2, 900 + k);
  }

  // --- farms
  const nFarms = 1 + (rng() < 0.6 ? 1 : 0);
  const farms = [];
  for (let k = 0; k < nFarms * 20 && farms.length < nFarms; k++) {
    const w = 110 + Math.floor(rng() * 60), h = 80 + Math.floor(rng() * 40);
    const x = 500 + Math.floor(rng() * (W - 900)), y = 30 + Math.floor(rng() * (H - h - 60));
    if (!areaFree(g, x, y, w, h, 20)) continue;
    let road = false;
    for (let xx = x; xx < x + w && !road; xx += 8) for (let yy = y; yy < y + h; yy += 8) if (onRoad(xx, yy)) { road = true; break; }
    if (road) continue;
    for (let yy = y - 12; yy < y + h + 12; yy++) for (let xx = x - 12; xx < x + w + 12; xx++) {
      if (g.inBounds(xx, yy) && g.mat[yy * W + xx] === M.GRASS) g.mat[yy * W + xx] = M.EMPTY; // yard
    }
    farmhouse(g, x, y, w, h, rng, avoid);
    farms.push({ x, y, w, h });
  }

  // --- hay bales and crates around farms / in fields
  for (let k = 0; k < 10; k++) {
    const cx = 260 + rng() * (W - 520), cy = 50 + rng() * (H - 100);
    const n = 2 + Math.floor(rng() * 4), row = rng() < 0.5;
    for (let b = 0; b < n; b++) {
      const x = cx + (row ? b * 13 : (rng() - 0.5) * 40), y = cy + (row ? 0 : (rng() - 0.5) * 40);
      if (!areaFree(g, Math.floor(x) - 6, Math.floor(y) - 6, 12, 12, 1) || onRoad(x, y) || avoid(x, y)) continue;
      const d = Math.floor(rng() * 4);
      disc(g, x, y, 5, (gg, xx, yy) => gg.setCell(xx, yy, M.HAY, d));
    }
  }
  for (const f of farms) {
    for (let c = 0; c < 3; c++) {
      const x = f.x + f.w + 4 + (c & 1) * 11, y = f.y + 10 + (c >> 1) * 11;
      if (areaFree(g, x, y, 10, 10, 1)) crate(g, x, y);
    }
  }

  // --- fuel drums
  const barrels = [];
  for (let k = 0; k < 40 && barrels.length < 5; k++) {
    let x, y;
    if (farms.length && rng() < 0.6) { const f = farms[Math.floor(rng() * farms.length)]; x = f.x - 10 + rng() * (f.w + 20); y = f.y + f.h + 10; }
    else { x = 300 + rng() * (W - 600); y = 40 + rng() * (H - 80); }
    x = Math.floor(x); y = Math.floor(y);
    if (!areaFree(g, x - 5, y - 5, 10, 10, 2) || avoid(x, y)) continue;
    const id = barrels.length + 1;
    for (let yy = -5; yy <= 5; yy++) for (let xx = -5; xx <= 5; xx++) if (xx * xx + yy * yy <= 20) g.setCell(x + xx, y + yy, M.BARREL, id);
    barrels.push({ x, y, done: false });
  }

  // --- old shell craters: scorched, grass burnt off
  for (let k = 0; k < 16; k++) {
    const x = 260 + rng() * (W - 400), y = 30 + rng() * (H - 60), r = 6 + rng() * 10;
    for (let yy = Math.floor(y - r); yy <= y + r; yy++) for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (!g.inBounds(xx, yy)) continue;
      const d = Math.hypot(xx - x, yy - y) / r, i = yy * W + xx;
      if (d > 1 || g.mat[i] === M.HEDGE || g.mat[i] === M.HAY || g.mat[i] === M.STONE || g.mat[i] === M.BRICK) continue;
      if (g.mat[i] === M.GRASS) g.mat[i] = M.EMPTY;
      g.scorch[i] = d < 0.6 ? 2 : 1;
    }
  }

  // hp for everything written directly
  for (let i = 0; i < g.mat.length; i++) if (g.mat[i] === M.GRASS) g.hp[i] = 1;

  const enemies = placeEnemies(g, rng, spawn, flag, roster(level, rng));
  bakeDaylight(g, seed + 99);

  g.structSize = new Int32Array(SID + 1);
  for (let i = 0; i < g.mat.length; i++) {
    if (g.mat[i] === M.BRICK || g.mat[i] === M.STONE) g.structSize[g.struct[i]]++;
  }
  g.dirty.fill(1);
  g.touched.length = 0;
  g.navBox = null;
  g.version++;
  return { spawn, flag, enemies, barrels, biome: 'field' };
}
