// DOM-free cell -> color logic, shared by the browser renderer and tools/.
import { M, MAT_HP, SOLID } from '../world/materials.js';
import { hash } from '../util/rng.js';
import { F } from '../world/worldgen.js';
import { WALL_FACE, SHADOW_LEN } from '../config.js';

// Colors are packed as little-endian ABGR Uint32 (ImageData layout).
export const g = (v) => ((255 << 24) | (v << 16) | (v << 8) | v) >>> 0;
export const RED = ((255 << 24) | (0x30 << 16) | (0x30 << 8) | 0xff) >>> 0;
export const BLACK = g(0);
export const WHITE = g(255);
export const rgb = (r, gg, b) => ((255 << 24) | (b << 16) | (gg << 8) | r) >>> 0;

// Element colors: the only colors in the world besides fire red.
export const ICE_LIGHT = rgb(0xdc, 0xf2, 0xff);
export const ICE_MID = rgb(0xa2, 0xd6, 0xf6);
export const ICE_DEEP = rgb(0x5c, 0x98, 0xcc);
export const ICE_DARK = rgb(0x1e, 0x38, 0x52);
export const OIL_FILM = rgb(0x62, 0xbe, 0x40);
export const OIL_DEEP = rgb(0x2a, 0x7c, 0x24);
export const OIL_GLOSS = rgb(0xc8, 0xff, 0x9c);
export const OIL_DARK = rgb(0x14, 0x40, 0x12);

const FLOOR = [];
FLOOR[F.TILE_A] = g(0xf4);
FLOOR[F.TILE_B] = g(0xe8);
FLOOR[F.LINE] = g(0x78);
FLOOR[F.DOT] = g(0x08);
FLOOR[F.CRACK] = g(0x55);
FLOOR[F.TRACK] = g(0xa0);

const BRICK_FACE = [0, g(0x14), g(0x1e), g(0x28)];
const STONE_FACE = [g(0xb8), g(0x30), g(0x3a), g(0x44)]; // 0 = mortar
const RUBBLE = [g(0x58), g(0x70), g(0x48)];
const WOOD = [g(0x3c), g(0x6e), g(0xa6)];               // outline, plank line, plank
const WRECK = [0, g(0x24), g(0x12), g(0x1a)];           // charred hull, tracks, turret

export const DEBRIS_COLOR = [0, g(0x20), g(0x48), g(0x50), g(0x6a), RED, g(0x10), g(0x30), RED, OIL_DEEP, ICE_LIGHT, OIL_DEEP];

// Light comes from the top-left: walls cast a shadow down-right.
// Returns the distance to the occluding wall (0 = lit).
function shadowDist(grid, x, y) {
  for (let k = 1; k <= SHADOW_LEN; k++) {
    if (grid.isSolid(x - k, y - k) || grid.isSolid(x - k, y) || grid.isSolid(x, y - k)) return k;
  }
  return 0;
}

// 3/4 view: a wall shows its front face on the last WALL_FACE rows above the
// floor, and its top everywhere else. Returns the row index from the floor
// (1 = touching the floor) or 0 for the top.
function faceRow(grid, x, y) {
  for (let k = 1; k <= WALL_FACE; k++) if (!grid.isSolid(x, y + k)) return k;
  return 0;
}

// 4x4 ordered dither thresholds, used to fade lit areas into black.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => ((v + 0.5) / 16) * 255);

export function cellColor(grid, x, y) {
  const i = y * grid.w + x;
  const m = grid.mat[i];
  const dark = grid.light[i] < BAYER[((y & 3) << 2) | (x & 3)];
  const fr = grid.frost[i];

  if (m === M.OIL) {
    const d = grid.data[i];
    if (fr) return dark ? ICE_DARK : ((x + y) & 1) ? ICE_MID : OIL_FILM; // frozen slick
    if (dark) return ((x + y) & 1) ? OIL_DARK : g(0x0c);
    if (hash(x >> 1, y >> 1) % 23 === 0) return OIL_GLOSS; // highlights
    return d >= 3 || ((x + y) & 1) ? OIL_DEEP : OIL_FILM;
  }

  if (fr && !SOLID[m]) { // ice sheet on the floor
    if (dark) return ((x + y) & 3) === 0 ? ICE_DEEP : ICE_DARK;
    if (fr > 60 && hash(x, y) % 9 === 0) return WHITE; // frost crystals
    if (m === M.RUBBLE) return ICE_DEEP;
    return ((x + y) & 1) ? ICE_LIGHT : ICE_MID;
  }

  if (m === M.EMPTY || m === M.RUBBLE) {
    const fl = grid.floor[i];
    if (dark) {
      // unlit floor: black, with the tile grid barely visible
      if (m === M.RUBBLE) return g(0x2c);
      return fl === F.LINE || fl === F.DOT ? g(0x22) : g(0x0c);
    }
    if (m === M.RUBBLE) return RUBBLE[grid.data[i]];
    const s = grid.scorch[i];
    if (s === 2) return (((x + y) & 3) === 0 || ((x - y) & 3) === 0) ? g(0x14) : g(0xa0);
    if (s === 1) return ((x + y * 2) % 5 === 0) ? g(0x30) : FLOOR[fl];
    const sd = fl !== F.DOT ? shadowDist(grid, x, y) : 0;
    if (sd) { // ink cross-hatching, denser near the wall
      const a = ((x + y) & 3) === 0, b = ((x - y) & 3) === 0;
      if (a || (sd <= 4 && b)) return sd <= 2 ? g(0x1a) : g(0x44);
      return sd <= 4 ? g(0xb8) : FLOOR[fl] === FLOOR[F.LINE] ? FLOOR[fl] : g(0xd4);
    }
    return FLOOR[fl];
  }

  const hurt = grid.hp[i] < MAT_HP[m];
  const d = grid.data[i];
  const chk = (x + y) & 1;

  if (m === M.WRECK) {
    if (!grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y) || !grid.isSolid(x, y - 1) || !grid.isSolid(x, y + 1)) {
      if (fr) return ICE_LIGHT;
      return dark ? g(0x30) : g(0x06); // wrecks: black, burnt edge
    }
    if (fr) return ((x + 2 * y) % 3 === 0) ? ICE_MID : ICE_DEEP;
  }

  // Masonry in 3/4 view: brick front face above the floor, dark cap on top,
  // white ink rim on the cap edges (so every shell hole gets a crisp outline).
  if (m === M.BRICK || m === M.STONE) {
    const fr0 = faceRow(grid, x, y);
    const sideOpen = !grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y);
    if (fr0) {
      if (fr) return fr0 === 1 ? ICE_DEEP : ((x + 2 * y) % 3 === 0) ? ICE_LIGHT : ICE_MID;
      if (fr0 === 1) return g(0x04);                          // contact line with the floor
      if (sideOpen) return dark ? g(0x60) : g(0xc8);          // face edge
      if (m === M.STONE) {
        if (d === 0) return dark ? g(0x40) : g(0x9a);
        return hurt && chk ? g(0x70) : fr0 === 2 ? g(0x26) : STONE_FACE[d];
      }
      if (d === 0) return dark ? g(0x3c) : hurt ? g(0x8c) : fr0 === 2 ? g(0x9a) : g(0xd2);
      return hurt && chk ? g(0x6a) : fr0 === 2 ? g(0x0c) : BRICK_FACE[d]; // darker at the foot
    }
    if (sideOpen || !grid.isSolid(x, y - 1)) return fr ? ICE_LIGHT : dark ? g(0x7c) : g(0xf0);
    if (fr) return ((x + 2 * y) % 3 === 0) ? ICE_MID : ICE_DEEP;
    // cap: charcoal with a diagonal hatch, stone a little lighter
    const hatch = ((x - y) & 3) === 0;
    if (m === M.STONE) return hatch ? g(0x6a) : dark ? g(0x28) : g(0x46);
    return hatch ? (dark ? g(0x2c) : g(0x3e)) : hurt && chk ? g(0x40) : g(0x1c);
  }

  switch (m) {
    case M.BRICK:
      if (d === 0) return dark ? g(0x44) : hurt ? g(0x8c) : g(0xd2);
      return hurt && chk ? g(0x6a) : BRICK_FACE[d];
    case M.STONE:
      if (d === 0) return dark ? g(0x48) : hurt ? g(0x90) : STONE_FACE[0];
      return hurt && chk ? g(0x88) : STONE_FACE[d];
    case M.WOOD:
      if (dark) return d === 0 ? g(0x10) : g(0x34);
      return hurt && chk ? g(0x50) : WOOD[d];
    case M.BARREL:
      return (x + y) % 3 === 0 ? RED : g(0x1a);
    case M.WRECK:
      return ((x - y) & 3) === 0 ? g(0x3c) : WRECK[d] || WRECK[1];
    default:
      return g(0x60);
  }
}
