// Cell -> color logic, shared by the game window and tools/.
#include <cmath>
#include "compose.h"

namespace {

uint32_t FLOOR[13];
uint8_t OUTDOOR[16];
float BAYER[16];
bool inited = false;

void init() {
  if (inited) return;
  inited = true;
  FLOOR[F::TILE_A] = g(0xf4);
  FLOOR[F::TILE_B] = g(0xe8);
  FLOOR[F::LINE] = g(0x78);
  FLOOR[F::DOT] = g(0x08);
  FLOOR[F::CRACK] = g(0x55);
  FLOOR[F::TRACK] = g(0xa0);
  FLOOR[F::GROUND] = g(0xe6);
  FLOOR[F::GROUND2] = g(0xd8);
  FLOOR[F::FURROW] = g(0x9c);
  FLOOR[F::ROAD] = g(0xf2);
  FLOOR[F::RUT] = g(0xc4);
  FLOOR[F::FLAT] = g(0xc8);
  FLOOR[F::PEBBLE] = g(0x70);
  // Floors that are outdoors: in shadow they go mid-gray, not black.
  for (uint8_t f : {F::GROUND, F::GROUND2, F::FURROW, F::ROAD, F::RUT, F::FLAT, F::PEBBLE}) OUTDOOR[f] = 1;
  // 4x4 ordered dither thresholds, used to fade lit areas into shadow.
  const int B[16] = {0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5};
  for (int i = 0; i < 16; i++) BAYER[i] = ((B[i] + 0.5f) / 16) * 255;
}

constexpr uint32_t BRICK_FACE[4] = {0, g(0x14), g(0x1e), g(0x28)};
constexpr uint32_t STONE_FACE[4] = {g(0xb8), g(0x30), g(0x3a), g(0x44)}; // 0 = mortar
constexpr uint32_t RUBBLE[3] = {g(0x58), g(0x70), g(0x48)};
constexpr uint32_t WOOD[3] = {g(0x3c), g(0x6e), g(0xa6)};               // outline, plank line, plank
constexpr uint32_t WRECK[4] = {0, g(0x24), g(0x12), g(0x1a)};           // charred hull, tracks, turret

// Light comes from the top-left: walls cast a shadow down-right.
// Returns the distance to the occluding wall (0 = lit).
int shadowDist(const Grid& grid, int x, int y) {
  for (int k = 1; k <= SHADOW_LEN; k++) {
    if (grid.isSolid(x - k, y - k) || grid.isSolid(x - k, y) || grid.isSolid(x, y - k)) return k;
  }
  return 0;
}

// 3/4 view: a wall shows its front face on the last WALL_FACE rows above the
// floor, and its top everywhere else. Returns the row index from the floor
// (1 = touching the floor) or 0 for the top.
int faceRow(const Grid& grid, int x, int y) {
  for (int k = 1; k <= WALL_FACE; k++) if (!grid.isSolid(x, y + k)) return k;
  return 0;
}

// Tall grass: a slightly darker meadow tone with small inked tufts ("V"
// strokes), one per 6x6 block at a jittered position, a few blocks bare.
uint32_t grassColor(int x, int y, bool dark) {
  int bx = (int)std::floor(x / 6.0), by = (int)std::floor(y / 6.0);
  uint32_t h = hash(bx, by);
  if (h % 5 != 0) {
    int tx = bx * 6 + 2 + (int)(h & 1), ty = by * 6 + 3 + (int)((h >> 4) % 3);
    int dx = x - tx, dy = y - ty, ax = std::abs(dx);
    bool ink = (dx == 0 && (dy == 0 || dy == -1)) || (ax == 1 && dy == -2) || (ax == 2 && dy == -3 && (h & 2));
    if (ink) return dark ? g(0x2a) : g(0x46);
  }
  return dark ? g(0x86) : g(0xcf);
}

// Foliage (hedges, bushes, tree crowns): dark leaf mass with light speckles.
uint32_t foliageColor(const Grid& grid, int x, int y, bool dark) {
  if (!grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y) || !grid.isSolid(x, y - 1) || !grid.isSolid(x, y + 1)) return C_BLACK;
  uint32_t h = hash(x >> 1, y >> 1);
  if (h % 7 == 0) return dark ? g(0x4a) : g(0x86);       // lit leaves
  if (!grid.isSolid(x, y - 2) || !grid.isSolid(x - 2, y)) return dark ? g(0x3a) : g(0x6c); // lit top-left edge
  return (h & 3) == 0 ? g(0x10) : g(0x24);
}

} // namespace

uint32_t cellColor(const Grid& grid, int x, int y) {
  init();
  int i = y * grid.w + x;
  uint8_t m = grid.mat[i];
  bool dark = grid.light[i] < BAYER[((y & 3) << 2) | (x & 3)];

  if (m == M::GRASS) {
    if (grid.scorch[i]) return ((x + y) & 3) == 0 ? g(0x20) : g(0x6a);
    return grassColor(x, y, dark);
  }

  if (m == M::EMPTY || m == M::RUBBLE) {
    uint8_t fl = grid.floor[i];
    if (dark) {
      if (OUTDOOR[fl]) { // cloud shadow: gray halftone
        if (m == M::RUBBLE) return g(0x3a);
        if (grid.scorch[i]) return g(0x30);
        return fl == F::FURROW || fl == F::RUT || fl == F::PEBBLE ? g(0x50) : g(0x7c);
      }
      // unlit indoor floor: black, with the tile grid barely visible
      if (m == M::RUBBLE) return g(0x2c);
      return fl == F::LINE || fl == F::DOT ? g(0x22) : g(0x0c);
    }
    if (m == M::RUBBLE) return RUBBLE[grid.data[i] % 3];
    uint8_t s = grid.scorch[i];
    if (s == 2) return (((x + y) & 3) == 0 || ((x - y) & 3) == 0) ? g(0x14) : g(0xa0);
    if (s == 1) return ((x + y * 2) % 5 == 0) ? g(0x30) : FLOOR[fl];
    int sd = fl != F::DOT ? shadowDist(grid, x, y) : 0;
    if (sd) { // ink cross-hatching, denser near the wall
      bool a = ((x + y) & 3) == 0, b = ((x - y) & 3) == 0;
      if (a || (sd <= 4 && b)) return sd <= 2 ? g(0x1a) : g(0x44);
      return sd <= 4 ? g(0xb8) : FLOOR[fl] == FLOOR[F::LINE] ? FLOOR[fl] : g(0xd4);
    }
    if (fl == F::GROUND || fl == F::GROUND2) return hash(x, y) % 29 == 0 ? g(0x9a) : FLOOR[fl]; // stippled soil
    return FLOOR[fl];
  }

  bool hurt = grid.hp[i] < MAT_HP[m];
  uint8_t d = grid.data[i];
  bool chk = ((x + y) & 1) != 0;

  if (m == M::WRECK) {
    if (!grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y) || !grid.isSolid(x, y - 1) || !grid.isSolid(x, y + 1)) {
      return dark ? g(0x30) : g(0x06); // wrecks: black, burnt edge
    }
  }

  // Masonry in 3/4 view: brick front face above the floor, dark cap on top,
  // white ink rim on the cap edges (so every shell hole gets a crisp outline).
  if (m == M::BRICK || m == M::STONE) {
    int fr0 = faceRow(grid, x, y);
    bool sideOpen = !grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y);
    if (fr0) {
      if (fr0 == 1) return g(0x04);                          // contact line with the floor
      if (sideOpen) return dark ? g(0x60) : g(0xc8);         // face edge
      if (m == M::STONE) {
        if (d == 0) return dark ? g(0x40) : g(0x9a);
        return hurt && chk ? g(0x70) : fr0 == 2 ? g(0x26) : STONE_FACE[d & 3];
      }
      if (d == 0) return dark ? g(0x3c) : hurt ? g(0x8c) : fr0 == 2 ? g(0x9a) : g(0xd2);
      return hurt && chk ? g(0x6a) : fr0 == 2 ? g(0x0c) : BRICK_FACE[d & 3]; // darker at the foot
    }
    if (sideOpen || !grid.isSolid(x, y - 1)) return dark ? g(0x7c) : g(0xf0);
    // cap: charcoal with a diagonal hatch, stone a little lighter
    bool hatch = ((x - y) & 3) == 0;
    if (m == M::STONE) return hatch ? g(0x6a) : dark ? g(0x28) : g(0x46);
    return hatch ? (dark ? g(0x2c) : g(0x3e)) : hurt && chk ? g(0x40) : g(0x1c);
  }

  switch (m) {
    case M::HEDGE:
      return hurt && chk ? g(0x50) : foliageColor(grid, x, y, dark);
    case M::HAY: {
      if (!grid.isSolid(x - 1, y) || !grid.isSolid(x + 1, y) || !grid.isSolid(x, y - 1) || !grid.isSolid(x, y + 1)) return C_BLACK;
      bool ring = (d + x + y) % 4 == 0; // straw rolled in a spiral
      return ring ? g(0x6a) : dark ? g(0x8a) : hurt && chk ? g(0x9a) : g(0xd8);
    }
    case M::WOOD:
      if (dark) return d == 0 ? g(0x10) : g(0x34);
      return hurt && chk ? g(0x50) : WOOD[d % 3];
    case M::BARREL:
      return (x + y) % 3 == 0 ? C_ORANGE : g(0x1a); // fuel drum: hazard orange
    case M::WRECK:
      return ((x - y) & 3) == 0 ? g(0x3c) : (d >= 1 && d <= 3 ? WRECK[d] : WRECK[1]);
    default:
      return g(0x60);
  }
}
