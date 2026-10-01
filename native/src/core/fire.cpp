#include <algorithm>
#include "util.h"
#include "world.h"

// Cell-based fire. Burning cells heat the gas field (which renders the flames
// and turns into smoke), spread to nearby flammables, set off fuel drums, and
// finally burn away leaving a scorch mark.
//   grass: flashes over in a few seconds, the front races across a field
//   hedge / hay: burn a while, throw fire to neighbours
//   wood: burns long, spreads slowly
namespace {
struct Burn { double lifeA, lifeB, spread, heat; };
Burn burnOf(uint8_t m) {
  switch (m) {
    case M::GRASS: return {18, 22, 0.2, 0.035};
    case M::HEDGE: return {80, 80, 0.14, 0.06};
    case M::HAY: return {110, 90, 0.18, 0.07};
    default: return {120, 120, 0.08, 0.06}; // wood
  }
}
}

void Fire::clear(Grid& grid) {
  list.clear();
  std::fill(grid.burn.begin(), grid.burn.end(), 0);
}

void Fire::ignite(Grid& grid, int x, int y) {
  if (!grid.inBounds(x, y)) return;
  int i = y * grid.w + x;
  uint8_t m = grid.mat[i];
  if (!FLAMMABLE[m] || grid.burn[i]) return;
  // some grass is green/damp and won't catch: fires stall in patchy meadows
  if (m == M::GRASS && hash(x, y) % 10 < 4) return;
  Burn b = burnOf(m);
  double life = jsround((b.lifeA + rnd() * b.lifeB) * lifeMult);
  grid.burn[i] = (uint8_t)std::min(255.0, std::max(2.0, life));
  list.push_back(i);
}

void Fire::step(Grid& grid, Gas& gas, const std::function<void(int)>& onBarrel) {
  const int w = grid.w;
  auto& mat = grid.mat; auto& burn = grid.burn;
  for (int k = (int)list.size() - 1; k >= 0; k--) {
    if (k >= (int)list.size()) continue; // list shrank under us (ignite/pop)
    int i = list[k];
    uint8_t m = mat[i];
    if (!FLAMMABLE[m]) { // blown away
      burn[i] = 0;
      list[k] = list.back(); list.pop_back();
      continue;
    }
    Burn b = burnOf(m);
    int x = i % w, y = i / w;
    gas.addHeat(x, y, b.heat);
    if (rnd() < 0.5) gas.addSmoke(x, y, m == M::GRASS ? 0.04 : 0.06);
    if (rnd() < 0.02) gas.addExpand(x, y, 0.05);

    // radiant heat jumps small gaps (up to 2 cells)
    if (rnd() < b.spread * spreadMult) {
      int ox = (int)(rnd() * 5);
      int oy = (int)(rnd() * 5);
      int nx = x + ox - 2, ny = y + oy - 2;
      if (grid.inBounds(nx, ny)) {
        int j = ny * w + nx;
        if (FLAMMABLE[mat[j]]) ignite(grid, nx, ny);
        else if (mat[j] == M::BARREL) onBarrel(grid.data[j]);
      }
    }

    if (rnd() < 0.5 && --burn[i] == 0) {
      grid.setCell(x, y, M::EMPTY);
      grid.scorch[i] = 2;
      list[k] = list.back(); list.pop_back();
    }
  }
}
