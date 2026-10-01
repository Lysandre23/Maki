#pragma once
// World simulation pieces: debris particles, explosions, fire, gas, nav,
// masonry collapse. All DOM/raylib-free (also run headless in tools/).
#include <cstdint>
#include <functional>
#include <unordered_map>
#include <vector>
#include "grid.h"

// Callbacks from the world into the game: a fuel drum is hit, a cell catches fire.
struct Hooks {
  std::function<void(int)> onBarrel;
  std::function<void(int, int)> ignite;
};

// Free-flying particles in flat arrays.
// Top-down view: no gravity. Debris gets an outward blast impulse, slides with
// damping, bounces off solids, then settles back into the grid as RUBBLE.
// SPARK: short-lived, ignores walls. EMBER: bounces, ignites what it touches
// (grass underneath too), burns out.
struct Debris {
  int max, n = 0;
  std::vector<float> x, y, vx, vy;
  std::vector<uint8_t> m;
  std::vector<int16_t> life; // -1 = until settled

  explicit Debris(int max);
  bool spawn(double x, double y, double vx, double vy, uint8_t m, int life = -1);
  void remove(int i);
  void clear() { n = 0; }
  void settle(Grid& grid, int i);
  void update(Grid& grid, double ax0, double ay0, double ax1, double ay1, const Hooks* hooks);
};

// Carve a crater. Returns number of destroyed cells.
int explode(Grid& grid, Debris& debris, double x, double y, double r, double power, const Hooks* hooks);

// Smoke, heat (fire) and steam carried by a 2D incompressible velocity field
// (stable fluids) on a coarse grid, inside a window that follows the camera.
struct Gas {
  int s, w, h, maxOx, maxOy, ox = 0, oy = 0;
  std::vector<double> u, v, u0, v0, p, div, curl, expand, tmp, smoke, heat, steam;
  std::vector<uint8_t> solid;
  std::vector<double> open, inv;
  double windX = 0, windY = 0;
  int active = 0;

  Gas(int worldW, int worldH, int scale, int winW, int winH);
  void clear();
  bool follow(double cx, double cy);
  void syncSolid(const Grid& grid);
  int cell(double x, double y) const;
  void addSmoke(double x, double y, double a);
  void addHeat(double x, double y, double a);
  void addSteam(double x, double y, double a);
  void addExpand(double x, double y, double a);
  void addVel(double x, double y, double vx, double vy);
  double smokeAt(double x, double y) const { int k = cell(x, y); return k < 0 ? 0 : smoke[k]; }
  double heatAt(double x, double y) const { int k = cell(x, y); return k < 0 ? 0 : heat[k]; }
  void blast(double x, double y, double r, double power, double heatMul = 1);
  void step();

  // solver stages (public for tools/gasbench)
  void vorticity();
  void advect(std::vector<double>& dst, const std::vector<double>& src, const std::vector<double>& U, const std::vector<double>& V);
  void project();
};

// Cell-based fire: burning cells heat the gas, spread, then burn away.
struct Fire {
  std::vector<int> list;
  double lifeMult = 1, spreadMult = 1;
  void clear(Grid& grid);
  void ignite(Grid& grid, int x, int y);
  void step(Grid& grid, Gas& gas, const std::function<void(int)>& onBarrel);
};

// Coarse navigation grid + BFS flow fields, cached per destination (LRU).
struct Nav {
  int c, w, h;
  std::vector<uint8_t> blocked, pass;
  std::vector<int32_t> queue;
  struct Entry { std::vector<int32_t> dist; uint64_t used; };
  std::unordered_map<int, Entry> cache;
  uint64_t useClock = 0;
  uint32_t version = 0;

  Nav(const Grid& grid, int cell = 12);
  void rebuild(const Grid& grid) { rebuildRegion(grid, 0, 0, grid.w - 1, grid.h - 1); }
  void rebuildRegion(const Grid& grid, int x0, int y0, int x1, int y1);
  int node(double x, double y) const;
  const std::vector<int32_t>& field(double x, double y);
  // Direction (radians) to walk from (x, y) down a distance field; false if none.
  bool dirAt(const std::vector<int32_t>& dist, double x, double y, double& out) const;
};

// Masonry fragments that lost their support after a blast (cell index lists).
std::vector<std::vector<int>> findCollapses(const Grid& grid, double x, double y, double R, int maxSize = 450, double ratio = 0.45);
