import { ROOMS } from '../config.js';
import { hash } from '../util/rng.js';
import { M } from './materials.js';

// Floor ids (colored by render/palette.js)
export const F = { TILE_A: 0, TILE_B: 1, LINE: 2, DOT: 3, CRACK: 4, TRACK: 5 };

const TILE = 24;

// Current masonry structure id, stamped into grid.struct (see world/collapse.js).
let SID = 0;
const BORDER = 10;

function brickCell(g, x, y) {
  const row = Math.floor(y / 4);
  const off = (row & 1) * 5;
  const mortar = (y & 3) === 3 || (x + off) % 10 === 9;
  const shade = mortar ? 0 : 1 + (hash(Math.floor((x + off) / 10), row) % 3);
  g.setCell(x, y, M.BRICK, shade);
  g.struct[y * g.w + x] = SID;
}

// Cut stone: 6x6 blocks separated by light mortar (data 0).
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

function paintFloor(g, seed) {
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const lx = x % TILE, ly = y % TILE;
      const dx = Math.min(lx, TILE - lx), dy = Math.min(ly, TILE - ly);
      let f;
      if (dx + dy <= 1) f = F.DOT;
      else if (lx === 0 || ly === 0) f = F.LINE;
      else f = hash(Math.floor(x / TILE) + seed, Math.floor(y / TILE)) & 1 ? F.TILE_B : F.TILE_A;
      g.floor[y * g.w + x] = f;
    }
  }

  // Cracks: short random walks
  const n = Math.floor((g.w * g.h) / 6000);
  for (let k = 0; k < n; k++) {
    const kk = k + seed * 1000;
    let x = hash(kk, 11) % g.w, y = hash(kk, 12) % g.h;
    let dirx = (hash(kk, 13) % 3) - 1, diry = (hash(kk, 14) % 3) - 1;
    if (!dirx && !diry) dirx = 1;
    const len = 8 + (hash(kk, 15) % 14);
    for (let s = 0; s < len; s++) {
      if (!g.inBounds(x, y)) break;
      if (g.floor[y * g.w + x] <= F.TILE_B) g.floor[y * g.w + x] = F.CRACK;
      const r = hash(kk, 100 + s) % 4;
      if (r === 0) dirx = Math.max(-1, Math.min(1, dirx + ((hash(kk, s) & 1) ? 1 : -1)));
      if (r === 1) diry = Math.max(-1, Math.min(1, diry + ((hash(s, kk) & 1) ? 1 : -1)));
      if (!dirx && !diry) dirx = 1;
      x += dirx; y += diry;
    }
  }
}

function wallLine(g, x, y, s, thick, horiz, avoid) {
  if (horiz) fillRect(g, x + s, y, 1, thick, brickCell, avoid);
  else fillRect(g, x, y + s, thick, 1, brickCell, avoid);
}

// Straight brick wall, with an optional doorway if long.
function segment(g, x, y, len, thick, horiz, rng, avoid) {
  SID++;
  let gapA = -1, gapB = -1;
  if (len > 130 && rng() < 0.7) { gapA = 20 + Math.floor(rng() * (len - 90)); gapB = gapA + 56; }
  for (let s = 0; s < len; s++) {
    if (s >= gapA && s < gapB) continue;
    wallLine(g, x, y, s, thick, horiz, avoid);
  }
}

// Long partition wall across the room with 2-3 wide doorways
// (wide enough for heavy tanks).
function partition(g, pos, a, b, thick, horiz, rng, avoid) {
  SID++;
  const doors = [];
  const n = 2 + (rng() < 0.5 ? 1 : 0);
  for (let k = 0; k < n * 6 && doors.length < n; k++) {
    const w = 58 + Math.floor(rng() * 24);
    const d = a + 30 + Math.floor(rng() * (b - a - 60 - w));
    if (doors.some(([s, e]) => d < e + 40 && d + w > s - 40)) continue;
    doors.push([d, d + w]);
  }
  for (let s = a; s < b; s++) {
    if (doors.some(([d0, d1]) => s >= d0 && s < d1)) continue;
    if (horiz) wallLine(g, s, pos, 0, thick, true, avoid);
    else wallLine(g, pos, s, 0, thick, false, avoid);
  }
}

// Baked "ceiling light" pools: bright floor under lights, black elsewhere.
function bakeLights(g, lights) {
  const acc = new Float32Array(g.w * g.h).fill(0.06);
  for (const L of lights) {
    const r2 = L.r * L.r;
    for (let y = Math.max(0, Math.floor(L.y - L.r)); y < Math.min(g.h, L.y + L.r); y++) {
      for (let x = Math.max(0, Math.floor(L.x - L.r)); x < Math.min(g.w, L.x + L.r); x++) {
        const d2 = (x - L.x) ** 2 + (y - L.y) ** 2;
        if (d2 >= r2) continue;
        const f = 1 - Math.sqrt(d2) / L.r;
        acc[y * g.w + x] += f * 1.7;
      }
    }
  }
  for (let i = 0; i < acc.length; i++) g.light[i] = Math.min(255, acc[i] * 255) | 0;
}

function rubblePile(g, x, y, r, rng) {
  for (let yy = -r; yy <= r; yy++) {
    for (let xx = -r; xx <= r; xx++) {
      const d = Math.sqrt(xx * xx + yy * yy) / r;
      if (d > 1 || rng() > (1 - d) * 0.9) continue;
      const cx = x + xx, cy = y + yy;
      if (g.inBounds(cx, cy) && g.mat[cy * g.w + cx] === M.EMPTY) g.setCell(cx, cy, M.RUBBLE, hash(cx, cy) % 3);
    }
  }
}

function crate(g, x, y) {
  for (let ly = 0; ly < 10; ly++) {
    for (let lx = 0; lx < 10; lx++) {
      const d = lx === 0 || ly === 0 || lx === 9 || ly === 9 ? 0 : ly % 3 === 0 ? 1 : 2;
      g.setCell(x + lx, y + ly, M.WOOD, d);
    }
  }
}

function roster(level, rng) {
  if (level >= ROOMS) return ['boss', 'gunner', 'gunner', 'scout', 'scout'];
  const n = Math.min(8, 2 + Math.floor(level * 0.7));
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rng();
    if (level <= 2) out.push(r < 0.5 ? 'scout' : 'gunner');
    else if (level <= 5) out.push(r < 0.3 ? 'scout' : r < 0.75 ? 'gunner' : 'heavy');
    else out.push(r < 0.25 ? 'scout' : r < 0.6 ? 'gunner' : 'heavy');
  }
  return out;
}

const SIZE = { scout: 22, gunner: 26, heavy: 30, boss: 40 };

// Builds a room into the grid. Returns spawn points and props.
export function generateRoom(g, rng, level) {
  g.mat.fill(0); g.hp.fill(0); g.data.fill(0); g.scorch.fill(0); g.burn.fill(0);
  paintFloor(g, level * 97 + Math.floor(rng() * 1000));
  const W = g.w, H = g.h;

  g.struct.fill(0);
  SID = 1;
  fillRect(g, 0, 0, W, BORDER, brickCell);
  fillRect(g, 0, H - BORDER, W, BORDER, brickCell);
  fillRect(g, 0, 0, BORDER, H, brickCell);
  fillRect(g, W - BORDER, 0, BORDER, H, brickCell);

  const spawn = { x: 80, y: Math.round(H / 2) };
  const avoid = (x, y) => (x - spawn.x) ** 2 + (y - spawn.y) ** 2 < 95 * 95;

  // Building layout: partition walls with doorways split the room into
  // sub-rooms (like the reference art), then extra wall stubs inside.
  const T = 14;
  const vx = [Math.round(W / 3 + (rng() - 0.5) * 80), Math.round((2 * W) / 3 + (rng() - 0.5) * 80)];
  const hy = Math.round(H / 2 + (rng() - 0.5) * 90);
  for (const x of vx) partition(g, x, BORDER, H - BORDER, T, false, rng, avoid);
  partition(g, hy, BORDER, W - BORDER, T, true, rng, avoid);

  const nStubs = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < nStubs; k++) {
    const thick = rng() < 0.5 ? 10 : 14;
    const horiz = rng() < 0.5;
    const len = 50 + Math.floor(rng() * 90);
    const x = 140 + Math.floor(rng() * (W - 260));
    const y = 40 + Math.floor(rng() * (H - 100));
    segment(g, x, y, len, thick, horiz, rng, avoid);
    if (rng() < 0.5) {
      const len2 = 40 + Math.floor(rng() * 60);
      if (horiz) segment(g, x + len - thick, rng() < 0.5 ? y : y - len2 + thick, len2, thick, false, rng, avoid);
      else segment(g, rng() < 0.5 ? x : x - len2 + thick, y + len - thick, len2, thick, true, rng, avoid);
    }
  }

  // Stone pillars
  const nPillars = 2 + Math.floor(rng() * 4);
  for (let k = 0; k < nPillars; k++) {
    const s = 12 + 6 * Math.floor(rng() * 3);
    const x = 120 + Math.floor(rng() * (W - 180)), y = 30 + Math.floor(rng() * (H - 90));
    if (areaFree(g, x, y, s, s, 10) && !avoid(x, y)) { SID++; fillRect(g, x, y, s, s, stoneCell); }
  }

  // Wooden crate clusters
  const crates = [];
  const nClusters = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < nClusters; k++) {
    const cx = 110 + Math.floor(rng() * (W - 180)), cy = 30 + Math.floor(rng() * (H - 80));
    const count = 1 + Math.floor(rng() * 4);
    for (let c = 0; c < count; c++) {
      const x = cx + (c & 1) * 11, y = cy + (c >> 1) * 11;
      if (areaFree(g, x, y, 10, 10, 3) && !avoid(x, y)) { crate(g, x, y); crates.push({ x, y }); }
    }
  }

  // Explosive barrels, often next to crates (chain reactions)
  const barrels = [];
  const nBarrels = 2 + Math.floor(rng() * 3) + (level > 3 ? 1 : 0);
  for (let k = 0; k < nBarrels * 4 && barrels.length < nBarrels; k++) {
    let x, y;
    if (crates.length && rng() < 0.6) {
      const c = crates[Math.floor(rng() * crates.length)];
      x = c.x + (rng() < 0.5 ? -7 : 17); y = c.y + 5 + Math.floor((rng() - 0.5) * 10);
    } else {
      x = 110 + Math.floor(rng() * (W - 170)); y = 30 + Math.floor(rng() * (H - 60));
    }
    if (!areaFree(g, x - 5, y - 5, 10, 10, 2) || avoid(x, y)) continue;
    const id = barrels.length + 1;
    for (let yy = -5; yy <= 5; yy++) {
      for (let xx = -5; xx <= 5; xx++) {
        if (xx * xx + yy * yy <= 20) g.setCell(x + xx, y + yy, M.BARREL, id);
      }
    }
    barrels.push({ x, y, done: false });
  }

  // Enemy spawns on the far side
  const enemies = [];
  for (const type of roster(level, rng)) {
    const s = SIZE[type];
    for (let tries = 0; tries < 400; tries++) {
      const minX = tries < 300 ? W * 0.42 : W * 0.25;
      const x = minX + rng() * (W - minX - 50), y = 45 + rng() * (H - 90);
      if (!areaFree(g, Math.floor(x - s), Math.floor(y - s), 2 * s, 2 * s)) continue;
      if (enemies.some((e) => (e.x - x) ** 2 + (e.y - y) ** 2 < 70 * 70)) continue;
      enemies.push({ type, x, y, a: Math.PI + (rng() - 0.5) });
      break;
    }
  }

  // Ruin dressing: rubble piles, mostly against walls
  for (let k = 0; k < 10; k++) {
    const x = 20 + Math.floor(rng() * (W - 40)), y = 20 + Math.floor(rng() * (H - 40));
    if (!avoid(x, y)) rubblePile(g, x, y, 5 + Math.floor(rng() * 8), rng);
  }

  // Lights: one over the player, a few over the rooms (enemies often lit)
  const lights = [{ x: spawn.x + 40, y: spawn.y, r: 190 }];
  const nLights = 4 + Math.floor(rng() * 3);
  for (let k = 0; k < nLights; k++) {
    const e = enemies[k];
    if (e && rng() < 0.6) lights.push({ x: e.x + (rng() - 0.5) * 80, y: e.y + (rng() - 0.5) * 80, r: 140 + rng() * 90 });
    else lights.push({ x: 60 + rng() * (W - 120), y: 40 + rng() * (H - 80), r: 140 + rng() * 110 });
  }
  bakeLights(g, lights);

  g.structSize = new Int32Array(SID + 1);
  for (let i = 0; i < g.mat.length; i++) {
    if (g.mat[i] === M.BRICK || g.mat[i] === M.STONE) g.structSize[g.struct[i]]++;
  }

  g.dirty.fill(1);
  g.touched.length = 0;
  g.version++;
  // Oil puddles from leaking drums: elemental terrain even without upgrades
  const puddles = [];
  const nPuddles = rng() < 0.7 ? 1 + Math.floor(rng() * 3) : 0;
  for (let k = 0; k < nPuddles * 5 && puddles.length < nPuddles; k++) {
    const x = 120 + Math.floor(rng() * (W - 200)), y = 40 + Math.floor(rng() * (H - 80));
    const r = 10 + Math.floor(rng() * 12);
    if (areaFree(g, x - r, y - r, 2 * r, 2 * r) && !avoid(x, y)) puddles.push({ x, y, r });
  }

  return { spawn, enemies, barrels, puddles };
}
