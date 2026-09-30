import { ROOMS } from '../config.js';
import { hash } from '../util/rng.js';
import { M } from './materials.js';
import { Nav } from './nav.js';

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

// ------------------------------------------------------------------ layout

const T = 14; // structural wall thickness

// Straight wall from a to b (along x if horiz, else y) at `pos`, with
// `nDoors` doorways. Doorways (plus an approach margin) are recorded in
// `doors` so props and cover never block them.
function wallWithDoors(g, pos, a, b, horiz, nDoors, rng, ctx) {
  SID++;
  const gaps = [];
  const len = b - a;
  for (let k = 0; k < nDoors * 8 && gaps.length < nDoors; k++) {
    const w = 62 + Math.floor(rng() * 20);
    if (len < w + 50) break;
    const d = a + 22 + Math.floor(rng() * (len - 44 - w));
    if (gaps.some(([s, e]) => d < e + 36 && d + w > s - 36)) continue;
    gaps.push([d, d + w]);
  }
  for (let s = a; s < b; s++) {
    if (gaps.some(([d0, d1]) => s >= d0 && s < d1)) continue;
    if (horiz) fillRect(g, s, pos, 1, T, brickCell, ctx.avoid);
    else fillRect(g, pos, s, T, 1, brickCell, ctx.avoid);
  }
  for (const [d0, d1] of gaps) {
    ctx.doors.push(horiz
      ? { x0: d0, y0: pos - 30, x1: d1, y1: pos + T + 30 }
      : { x0: pos - 30, y0: d0, x1: pos + T + 30, y1: d1 });
  }
}

// Ruined office block: a 3x2 grid of rooms. Every wall segment between two
// junctions gets a doorway, so all rooms connect and there are loops to flank.
function layoutHalls(g, rng, ctx) {
  const W = g.w, H = g.h, B = BORDER;
  const vx = [Math.round(W / 3 + (rng() - 0.5) * 70), Math.round((2 * W) / 3 + (rng() - 0.5) * 70)];
  const hy = Math.round(H / 2 + (rng() - 0.5) * 80);
  const doors = () => (rng() < 0.25 ? 2 : 1);
  let opened = 0;
  const seg = (pos, a, b, horiz) => {
    if (opened < 1 && rng() < 0.15) { opened++; return; } // one wall knocked out: open plan
    wallWithDoors(g, pos, a, b, horiz, doors(), rng, ctx);
  };
  for (const x of vx) { seg(x, B, hy, false); seg(x, hy + T, H - B, false); }
  seg(hy, B, vx[0], true); seg(hy, vx[0] + T, vx[1], true); seg(hy, vx[1] + T, W - B, true);
  const xs = [B, vx[0] + T, vx[1] + T, W - B], ys = [B, hy + T, H - B];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) ctx.rooms.push({ x: (xs[i] + xs[i + 1] - T) / 2, y: (ys[j] + ys[j + 1] - T) / 2 });
}

// Three long lanes split by two broken walls: fight down a lane, or slip
// through a gap to flank.
function layoutLanes(g, rng, ctx) {
  const W = g.w, H = g.h;
  const y1 = Math.round(H / 3 + (rng() - 0.5) * 40), y2 = Math.round((2 * H) / 3 + (rng() - 0.5) * 40);
  for (const y of [y1, y2]) wallWithDoors(g, y, 170, W - 110, true, 2 + (rng() < 0.5 ? 1 : 0), rng, ctx);
  for (const y of [(BORDER + y1) / 2, (y1 + y2 + T) / 2, (y2 + T + H - BORDER) / 2]) {
    ctx.rooms.push({ x: W * 0.35, y }, { x: W * 0.75, y });
  }
}

// A walled courtyard in the middle with one gate per side; the outer ring is
// a corridor around it.
function layoutCourtyard(g, rng, ctx) {
  const W = g.w, H = g.h;
  const x0 = 270 + Math.floor((rng() - 0.5) * 40), x1 = W - 200 + Math.floor((rng() - 0.5) * 40);
  const y0 = 120 + Math.floor((rng() - 0.5) * 30), y1 = H - 120 + Math.floor((rng() - 0.5) * 30);
  wallWithDoors(g, y0, x0, x1 + T, true, 1 + (rng() < 0.4 ? 1 : 0), rng, ctx);
  wallWithDoors(g, y1, x0, x1 + T, true, 1 + (rng() < 0.4 ? 1 : 0), rng, ctx);
  wallWithDoors(g, x0, y0 + T, y1, false, 1, rng, ctx);
  wallWithDoors(g, x1, y0 + T, y1, false, 1, rng, ctx);
  ctx.rooms.push({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, { x: (x0 + x1) / 2, y: y0 / 2 },
    { x: (x0 + x1) / 2, y: (y1 + H) / 2 }, { x: (x1 + W) / 2, y: H / 2 });
}

// Boss arena: one big hall ringed with heavy stone pillars.
function layoutArena(g, rng, ctx) {
  const W = g.w, H = g.h, cx = W * 0.58, cy = H / 2;
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2 + 0.3;
    const x = Math.round(cx + Math.cos(a) * 230 - 12), y = Math.round(cy + Math.sin(a) * 170 - 12);
    if (!areaFree(g, x, y, 24, 24, 8)) continue;
    SID++;
    fillRect(g, x, y, 24, 24, stoneCell, ctx.avoid);
  }
  ctx.rooms.push({ x: cx, y: cy });
}

// Short cover walls on open ground, facing the player's side of the room
// (mostly vertical, since the player comes from the left). Kept 30 cells
// clear of other solids so tanks can always drive around them.
function placeCover(g, rng, ctx, n) {
  const W = g.w, H = g.h;
  let placed = 0;
  for (let k = 0; k < n * 30 && placed < n; k++) {
    const x = 170 + Math.floor(rng() * (W - 250)), y = 40 + Math.floor(rng() * (H - 100));
    const r = rng();
    const len = 34 + Math.floor(rng() * 26), thick = 10;
    let w, h;
    if (r < 0.7) { w = thick; h = len; } else { w = len; h = thick; }
    if (!areaFree(g, x, y, w, h, 30) || ctx.blocked(x, y, w, h)) continue;
    SID++;
    fillRect(g, x, y, w, h, brickCell, ctx.avoid);
    if (r > 0.85) fillRect(g, x, y + h - thick, len, thick, brickCell, ctx.avoid); // L
    placed++;
  }
}

// Straight-line check through the grid (every 2 cells).
function clearLine(g, x0, y0, x1, y1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 2);
  for (let k = 1; k < n; k++) {
    if (g.isSolid(Math.floor(x0 + ((x1 - x0) * k) / n), Math.floor(y0 + ((y1 - y0) * k) / n))) return false;
  }
  return true;
}

// Enemies take defensive spots: reachable, with cover between them and the
// player's entry, hidden from it, spread out. Scouts like the flanks, heavies
// hold the middle.
function placeEnemies(g, rng, spawn, types) {
  const W = g.w, H = g.h;
  const nav = new Nav(g, 12);
  nav.rebuild(g);
  nav.flow(spawn.x, spawn.y);
  const cands = [];
  for (let y = 50; y < H - 50; y += 16) {
    for (let x = Math.round(W * 0.4); x < W - 40; x += 16) {
      if (!areaFree(g, x - 24, y - 24, 48, 48)) continue;
      const node = Math.floor(y / nav.c) * nav.w + Math.floor(x / nav.c);
      if (nav.dist[node] < 0) continue; // unreachable pocket
      const dx = spawn.x - x, dy = spawn.y - y, d = Math.hypot(dx, dy);
      let cover = 0;
      for (let s = 16; s <= 70; s += 3) {
        if (g.isSolid(Math.floor(x + (dx / d) * s), Math.floor(y + (dy / d) * s))) { cover = s < 30 ? 1.5 : 2.5; break; }
      }
      const hidden = !clearLine(g, spawn.x, spawn.y, x, y);
      cands.push({ x, y, base: cover + (hidden ? 2 : 0) + x / W });
    }
  }
  const out = [];
  for (const type of types) {
    const s = SIZE[type];
    let best = null, bs = -Infinity;
    for (let relax = 0; relax < 2 && !best; relax++) {
      const minD = relax ? 60 : 95;
      for (const c of cands) {
        if (!areaFree(g, Math.floor(c.x - s), Math.floor(c.y - s), 2 * s, 2 * s)) continue;
        if (out.some((e) => (e.x - c.x) ** 2 + (e.y - c.y) ** 2 < minD * minD)) continue;
        const edge = Math.abs(c.y - H / 2) / (H / 2); // 0 middle, 1 edge
        const role = type === 'scout' ? edge * 1.5 : type === 'heavy' || type === 'boss' ? (1 - edge) * 1.5 : 0;
        const sc = c.base + role + rng() * 1.2;
        if (sc > bs) { bs = sc; best = c; }
      }
    }
    if (best) out.push({ type, x: best.x, y: best.y, a: Math.atan2(spawn.y - best.y, spawn.x - best.x) });
  }
  return out;
}

const SIZE = { scout: 22, gunner: 26, heavy: 30, boss: 40 };
const LAYOUTS = [layoutHalls, layoutLanes, layoutCourtyard];

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
  const ctx = {
    doors: [],
    rooms: [],
    avoid: (x, y) => (x - spawn.x) ** 2 + (y - spawn.y) ** 2 < 95 * 95,
  };
  // true if the rect overlaps a doorway approach or the spawn
  ctx.blocked = (x, y, w, h) => ctx.avoid(x + w / 2, y + h / 2) ||
    ctx.doors.some((d) => x < d.x1 && x + w > d.x0 && y < d.y1 && y + h > d.y0);

  const layout = level >= ROOMS ? layoutArena : LAYOUTS[Math.floor(rng() * LAYOUTS.length)];
  layout(g, rng, ctx);
  placeCover(g, rng, ctx, 4 + Math.floor(rng() * 3));

  // Stone pillars
  const nPillars = 2 + Math.floor(rng() * 3);
  for (let k = 0, made = 0; k < nPillars * 10 && made < nPillars; k++) {
    const s = 12 + 6 * Math.floor(rng() * 3);
    const x = 120 + Math.floor(rng() * (W - 180)), y = 30 + Math.floor(rng() * (H - 90));
    if (!areaFree(g, x, y, s, s, 26) || ctx.blocked(x, y, s, s)) continue;
    SID++;
    fillRect(g, x, y, s, s, stoneCell);
    made++;
  }

  // Wooden crates, stacked against walls (never in doorways)
  const crates = [];
  const nClusters = 3 + Math.floor(rng() * 3);
  for (let k = 0, made = 0; k < nClusters * 40 && made < nClusters; k++) {
    const cx = 60 + Math.floor(rng() * (W - 120)), cy = 30 + Math.floor(rng() * (H - 60));
    const nearWall = [[-12, 0], [22, 0], [0, -12], [0, 22]].some(([ox, oy]) => g.isSolid(cx + ox, cy + oy));
    if (!nearWall || !areaFree(g, cx, cy, 21, 21, 1) || ctx.blocked(cx - 6, cy - 6, 33, 33)) continue;
    const count = 1 + Math.floor(rng() * 4);
    for (let c = 0; c < count; c++) {
      const x = cx + (c & 1) * 11, y = cy + (c >> 1) * 11;
      if (areaFree(g, x, y, 10, 10, 1)) { crate(g, x, y); crates.push({ x, y }); }
    }
    made++;
  }

  // Explosive barrels, often next to crates (chain reactions)
  const barrels = [];
  const nBarrels = 2 + Math.floor(rng() * 3) + (level > 3 ? 1 : 0);
  for (let k = 0; k < nBarrels * 6 && barrels.length < nBarrels; k++) {
    let x, y;
    if (crates.length && rng() < 0.6) {
      const c = crates[Math.floor(rng() * crates.length)];
      x = c.x + (rng() < 0.5 ? -7 : 17); y = c.y + 5 + Math.floor((rng() - 0.5) * 10);
    } else {
      x = 110 + Math.floor(rng() * (W - 170)); y = 30 + Math.floor(rng() * (H - 60));
    }
    if (!areaFree(g, x - 5, y - 5, 10, 10, 2) || ctx.blocked(x - 5, y - 5, 10, 10)) continue;
    const id = barrels.length + 1;
    for (let yy = -5; yy <= 5; yy++) {
      for (let xx = -5; xx <= 5; xx++) {
        if (xx * xx + yy * yy <= 20) g.setCell(x + xx, y + yy, M.BARREL, id);
      }
    }
    barrels.push({ x, y, done: false });
  }

  const enemies = placeEnemies(g, rng, spawn, roster(level, rng));

  // Ruin dressing: rubble piles at the foot of walls
  for (let k = 0, made = 0; k < 200 && made < 10; k++) {
    const x = 20 + Math.floor(rng() * (W - 40)), y = 20 + Math.floor(rng() * (H - 40));
    if (g.isSolid(x, y) || ctx.avoid(x, y)) continue;
    if (![[-8, 0], [8, 0], [0, -8], [0, 8]].some(([ox, oy]) => g.isSolid(x + ox, y + oy))) continue;
    rubblePile(g, x, y, 5 + Math.floor(rng() * 7), rng);
    made++;
  }

  // Lights: over the entry, over most rooms (some left dark), and over a few
  // enemy positions so they stand out
  const lights = [{ x: spawn.x + 40, y: spawn.y, r: 190 }];
  for (const r of ctx.rooms) if (rng() < 0.7) lights.push({ x: r.x + (rng() - 0.5) * 40, y: r.y + (rng() - 0.5) * 40, r: 130 + rng() * 80 });
  for (const e of enemies) {
    if (e.type === 'boss') lights.push({ x: e.x, y: e.y, r: 170 }); // the boss gets a spotlight
    else if (rng() < 0.35) lights.push({ x: e.x, y: e.y, r: 90 + rng() * 50 });
  }
  bakeLights(g, lights);

  g.structSize = new Int32Array(SID + 1);
  for (let i = 0; i < g.mat.length; i++) {
    if (g.mat[i] === M.BRICK || g.mat[i] === M.STONE) g.structSize[g.struct[i]]++;
  }

  // Oil puddles from leaking drums: elemental terrain even without upgrades
  const puddles = [];
  const nPuddles = rng() < 0.7 ? 1 + Math.floor(rng() * 3) : 0;
  for (let k = 0; k < nPuddles * 5 && puddles.length < nPuddles; k++) {
    const x = 120 + Math.floor(rng() * (W - 200)), y = 40 + Math.floor(rng() * (H - 80));
    const r = 10 + Math.floor(rng() * 12);
    if (areaFree(g, x - r, y - r, 2 * r, 2 * r) && !ctx.avoid(x, y)) puddles.push({ x, y, r });
  }

  g.dirty.fill(1);
  g.touched.length = 0;
  g.version++;
  return { spawn, enemies, barrels, puddles, layout: layout.name.replace('layout', '').toLowerCase() };
}
