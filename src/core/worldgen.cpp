#include "worldgen.h"
#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include "world.h"

// NOTE: every rng() call happens in the same order as the JS version, so a
// seed gives the same battlefield in both. Keep calls in separate statements
// (C++ leaves argument evaluation order unspecified).

namespace {

int SID = 0; // current masonry structure id, stamped into grid.structId
constexpr int BORDER = 8;

using CellFn = std::function<void(Grid&, int, int)>;
using AvoidFn = std::function<bool(double, double)>;

void brickCell(Grid& g, int x, int y) {
  int row = (int)std::floor(y / 4.0);
  int off = (row & 1) * 5;
  bool mortar = (y & 3) == 3 || (x + off) % 10 == 9;
  uint8_t shade = mortar ? 0 : (uint8_t)(1 + hash((int)std::floor((x + off) / 10.0), row) % 3);
  g.setCell(x, y, M::BRICK, shade);
  g.structId[y * g.w + x] = (uint16_t)SID;
}

void stoneCell(Grid& g, int x, int y) {
  bool mortar = x % 6 == 5 || y % 6 == 5;
  g.setCell(x, y, M::STONE, mortar ? 0 : (uint8_t)(1 + hash(x / 6, y / 6) % 3));
  g.structId[y * g.w + x] = (uint16_t)SID;
}

void fillRect(Grid& g, int x, int y, int w, int h, const CellFn& fn, const AvoidFn* avoid = nullptr) {
  for (int yy = y; yy < y + h; yy++) {
    for (int xx = x; xx < x + w; xx++) {
      if (g.inBounds(xx, yy) && !(avoid && (*avoid)(xx, yy))) fn(g, xx, yy);
    }
  }
}

bool areaFree(const Grid& g, int x, int y, int w, int h, int pad = 0) {
  for (int yy = y - pad; yy < y + h + pad; yy += 2) {
    for (int xx = x - pad; xx < x + w + pad; xx += 2) {
      if (g.isSolid(xx, yy)) return false;
    }
  }
  return true;
}

// Smooth value noise in [0, 1], two octaves.
double noise(double x, double y, double scale, int seed) {
  auto oct = [&](double sc, int sd) {
    double fx = x / sc, fy = y / sc;
    double x0 = std::floor(fx), y0 = std::floor(fy);
    double tx = fx - x0, ty = fy - y0;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    auto r = [&](double i, double j) { return (hash((int)(i + sd * 131.0), (int)(j - sd * 71.0)) & 1023) / 1023.0; };
    double a = r(x0, y0) + (r(x0 + 1, y0) - r(x0, y0)) * tx;
    double b = r(x0, y0 + 1) + (r(x0 + 1, y0 + 1) - r(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
  return oct(scale, seed) * 0.7 + oct(scale / 2.7, seed + 17) * 0.3;
}

void disc(Grid& g, double cx, double cy, double r, const CellFn& fn, double ragged = 0, int seed = 0) {
  for (int y = (int)std::floor(cy - r - ragged); y <= cy + r + ragged; y++) {
    for (int x = (int)std::floor(cx - r - ragged); x <= cx + r + ragged; x++) {
      double a = std::atan2(y - cy, x - cx);
      double rr = r + (ragged != 0 ? (hash((int)jsround(a * 6) + seed, seed) % 100) / 100.0 * ragged : 0);
      if (sq(x + 0.5 - cx) + sq(y + 0.5 - cy) <= rr * rr && g.inBounds(x, y)) fn(g, x, y);
    }
  }
}

void hedgeCell(Grid& g, int x, int y) {
  uint8_t m = g.mat[y * g.w + x];
  if (m == M::EMPTY || m == M::GRASS) g.setCell(x, y, M::HEDGE);
}

void crate(Grid& g, int x, int y) {
  for (int ly = 0; ly < 10; ly++) {
    for (int lx = 0; lx < 10; lx++) {
      uint8_t d = lx == 0 || ly == 0 || lx == 9 || ly == 9 ? 0 : ly % 3 == 0 ? 1 : 2;
      g.setCell(x + lx, y + ly, M::WOOD, d);
    }
  }
}

// Baked light: full daylight with drifting cloud shadows (halftone).
void bakeDaylight(Grid& g, int seed) {
  for (int y = 0; y < g.h; y++) {
    for (int x = 0; x < g.w; x++) {
      double n = noise(x, y, 260, seed);
      g.light[y * g.w + x] = n < 0.55 ? 255 : (uint8_t)(int)std::max(110.0, 255 - (n - 0.55) * 900);
    }
  }
}

// Farmhouse: brick walls with a doorway on each long side.
void farmhouse(Grid& g, int x, int y, int w, int h, Rng& rng, const AvoidFn& avoid) {
  SID++;
  const int T = 8;
  int d1 = x + 12 + (int)std::floor(rng() * (w - 60));
  int d2 = x + 12 + (int)std::floor(rng() * (w - 60));
  for (int xx = x; xx < x + w; xx++) {
    if (xx < d1 || xx >= d1 + 34) fillRect(g, xx, y, 1, T, brickCell, &avoid);
    if (xx < d2 || xx >= d2 + 34) fillRect(g, xx, y + h - T, 1, T, brickCell, &avoid);
  }
  fillRect(g, x, y, T, h, brickCell, &avoid);
  fillRect(g, x + w - T, y, T, h, brickCell, &avoid);
}

std::vector<std::string> roster(int level, Rng& rng) {
  int n = 5 + level;
  std::vector<std::string> out;
  for (int i = 0; i < n; i++) {
    double r = rng();
    if (level <= 2) out.push_back(r < 0.45 ? "scout" : r < 0.9 ? "gunner" : "heavy");
    else out.push_back(r < 0.3 ? "scout" : r < 0.7 ? "gunner" : "heavy");
  }
  if (level >= 7) out[0] = "boss";
  return out;
}

int sizeOf(const std::string& t) { return t == "scout" ? 22 : t == "gunner" ? 26 : t == "heavy" ? 30 : 40; }

// Defenders take spots in the enemy half: reachable, covered from the
// player's approach (hedges!), spread out; a few guard the flag.
std::vector<EnemySpawn> placeEnemies(Grid& g, Rng& rng, Pt spawn, Pt flag, const std::vector<std::string>& types) {
  const int W = g.w, H = g.h;
  Nav nav(g, 12);
  nav.rebuild(g);
  const auto& dist = nav.field(spawn.x, spawn.y);
  struct Cand { int x, y; double base; };
  std::vector<Cand> cands;
  for (int y = 50; y < H - 50; y += 20) {
    for (int x = (int)jsround(W * 0.42); x < W - 50; x += 20) {
      if (!areaFree(g, x - 24, y - 24, 48, 48)) continue;
      if (dist[(y / nav.c) * nav.w + (x / nav.c)] < 0) continue;
      double cover = 0;
      for (int s = 20; s <= 80; s += 4) {
        if (g.isSolid(x - s, y)) { cover = 2; break; } // something between us and the west
      }
      double toFlag = std::hypot(x - flag.x, y - flag.y);
      cands.push_back({x, y, cover + (toFlag < 260 ? 1.5 : 0) + x / (double)W});
    }
  }
  std::vector<EnemySpawn> out;
  for (const auto& type : types) {
    int s = sizeOf(type);
    const Cand* best = nullptr;
    double bs = -std::numeric_limits<double>::infinity();
    for (int relax = 0; relax < 2 && !best; relax++) {
      double minD = relax ? 70 : 130;
      for (const auto& c : cands) {
        if (!areaFree(g, (int)std::floor(c.x - s), (int)std::floor(c.y - s), 2 * s, 2 * s)) continue;
        bool near = false;
        for (const auto& e : out) if (sq(e.x - c.x) + sq(e.y - c.y) < minD * minD) { near = true; break; }
        if (near) continue;
        double sc = c.base + (type == "boss" ? 3 - std::hypot(c.x - flag.x, c.y - flag.y) / 150 : 0);
        sc += rng() * 2;
        if (sc > bs) { bs = sc; best = &c; }
      }
    }
    if (best) out.push_back({type, (double)best->x, (double)best->y, kPI});
  }
  return out;
}

} // namespace

Layout generateBattle(Grid& g, Rng& rng, int level) {
  std::fill(g.mat.begin(), g.mat.end(), 0);
  std::fill(g.hp.begin(), g.hp.end(), 0);
  std::fill(g.data.begin(), g.data.end(), 0);
  std::fill(g.scorch.begin(), g.scorch.end(), 0);
  std::fill(g.burn.begin(), g.burn.end(), 0);
  std::fill(g.structId.begin(), g.structId.end(), 0);
  SID = 1;
  const int W = g.w, H = g.h;
  const int seed = (int)std::floor(rng() * 10000);

  Layout L;
  L.spawn = {110, jsround(H / 2.0 + (rng() - 0.5) * 200)};
  L.flag = {(double)(W - 200), jsround(H / 2.0 + (rng() - 0.5) * 360)};
  const Pt spawn = L.spawn, flag = L.flag;
  const AvoidFn avoid = [=](double x, double y) {
    return sq(x - spawn.x) + sq(y - spawn.y) < 130 * 130 || sq(x - flag.x) + sq(y - flag.y) < 90 * 90;
  };

  // --- ground: soil patches, a winding road, plowed fields
  auto roadY = [&](double x) { return spawn.y + (flag.y - spawn.y) * (x / W) + std::sin(x * 0.004 + seed) * 70; };
  struct Field { double x, y, w, h; bool horiz; };
  std::vector<Field> fields;
  for (int k = 0; k < 7; k++) {
    double fw = 160 + rng() * 220;
    double fh = 110 + rng() * 170;
    double fx = 220 + rng() * (W - 500);
    double fy = rng() * (H - fh);
    bool horiz = rng() < 0.5;
    fields.push_back({fx, fy, fw, fh, horiz});
  }
  for (int y = 0; y < H; y++) {
    for (int x = 0; x < W; x++) {
      int i = y * W + x;
      double ry = std::abs(y - roadY(x));
      uint8_t f;
      if (ry < 13) f = std::abs(ry - 6) < 1.5 ? F::RUT : F::ROAD;
      else {
        f = noise(x, y, 90, seed) > 0.5 ? F::GROUND2 : F::GROUND;
        for (const auto& fl : fields) {
          if (x >= fl.x && x < fl.x + fl.w && y >= fl.y && y < fl.y + fl.h) {
            f = ((fl.horiz ? y : x) % 5 == 0) ? F::FURROW : F::GROUND2;
            break;
          }
        }
        if (hash(x, y) % 211 == 0) f = F::PEBBLE;
      }
      g.floor[i] = f;
      // meadows of tall grass away from the road and the plowed fields
      if (f != F::ROAD && f != F::RUT && f != F::FURROW && noise(x, y, 150, seed + 5) > 0.5) g.mat[i] = M::GRASS;
    }
  }

  // --- border (low stone field walls)
  fillRect(g, 0, 0, W, BORDER, stoneCell);
  fillRect(g, 0, H - BORDER, W, BORDER, stoneCell);
  fillRect(g, 0, 0, BORDER, H, stoneCell);
  fillRect(g, W - BORDER, 0, BORDER, H, stoneCell);

  // --- bocage: north-south hedgerows with gaps, plus east-west stubs
  auto onRoad = [&](double x, double y) { return std::abs(y - roadY(x)) < 16; };
  std::vector<int> cols;
  for (int cx = 460; cx < W - 360; cx += 380 + (int)std::floor(rng() * 120)) cols.push_back(cx);
  for (int x0 : cols) {
    std::vector<std::pair<int, int>> gaps;
    int n = 2 + (rng() < 0.5 ? 1 : 0);
    for (int k = 0; k < n; k++) {
      int gy = 40 + (int)std::floor(rng() * (H - 160));
      int ge = gy + 70 + (int)std::floor(rng() * 40);
      gaps.push_back({gy, ge});
    }
    double ph = rng() * 6;
    for (int y = BORDER; y < H - BORDER; y++) {
      bool inGap = false;
      for (auto& gp : gaps) if (y >= gp.first && y < gp.second) { inGap = true; break; }
      if (inGap) continue;
      double cx = x0 + std::sin(y * 0.021 + ph) * 9;
      int ht = 5 + (int)(hash(x0, y >> 3) % 4);
      for (int x = (int)std::floor(cx - ht); x <= cx + ht; x++) {
        if (!onRoad(x, y) && !avoid(x, y)) hedgeCell(g, x, y);
      }
    }
  }
  for (size_t k = 0; k < cols.size() * 2; k++) {
    int i = (int)std::floor(rng() * (cols.size() + 1));
    int xa = i == 0 ? 220 : cols[i - 1] + 10, xb = i == (int)cols.size() ? W - 260 : cols[i] - 10;
    int y0 = 60 + (int)std::floor(rng() * (H - 120));
    int len = std::min(xb - xa, 120 + (int)std::floor(rng() * 200));
    int xs = xa + (int)std::floor(rng() * std::max(1, xb - xa - len));
    double ph = rng() * 6;
    for (int x = xs; x < xs + len; x++) {
      double cy = y0 + std::sin(x * 0.03 + ph) * 6;
      for (int y = (int)std::floor(cy - 5); y <= cy + 5; y++) if (!onRoad(x, y) && !avoid(x, y)) hedgeCell(g, x, y);
    }
  }

  // --- copses and lone trees (crowns = foliage discs)
  int nCopses = 5 + (int)std::floor(rng() * 4);
  for (int k = 0; k < nCopses; k++) {
    double cx = 260 + rng() * (W - 520);
    double cy = 50 + rng() * (H - 100);
    int nt = 3 + (int)std::floor(rng() * 6);
    for (int t = 0; t < nt; t++) {
      double x = cx + (rng() - 0.5) * 90;
      double y = cy + (rng() - 0.5) * 70;
      if (!onRoad(x, y) && !avoid(x, y)) disc(g, x, y, 7 + rng() * 8, hedgeCell, 3, k * 31 + t);
    }
  }
  for (int k = 0; k < 14; k++) {
    double x = 240 + rng() * (W - 480);
    double y = 40 + rng() * (H - 80);
    if (!onRoad(x, y) && !avoid(x, y)) disc(g, x, y, 6 + rng() * 5, hedgeCell, 2, 900 + k);
  }

  // --- farms
  int nFarms = 1 + (rng() < 0.6 ? 1 : 0);
  struct Farm { int x, y, w, h; };
  std::vector<Farm> farms;
  for (int k = 0; k < nFarms * 20 && (int)farms.size() < nFarms; k++) {
    int w = 110 + (int)std::floor(rng() * 60);
    int h = 80 + (int)std::floor(rng() * 40);
    int x = 500 + (int)std::floor(rng() * (W - 900));
    int y = 30 + (int)std::floor(rng() * (H - h - 60));
    if (!areaFree(g, x, y, w, h, 20)) continue;
    bool road = false;
    for (int xx = x; xx < x + w && !road; xx += 8) for (int yy = y; yy < y + h; yy += 8) if (onRoad(xx, yy)) { road = true; break; }
    if (road) continue;
    for (int yy = y - 12; yy < y + h + 12; yy++) for (int xx = x - 12; xx < x + w + 12; xx++) {
      if (g.inBounds(xx, yy) && g.mat[yy * W + xx] == M::GRASS) g.mat[yy * W + xx] = M::EMPTY; // yard
    }
    farmhouse(g, x, y, w, h, rng, avoid);
    farms.push_back({x, y, w, h});
  }

  // --- hay bales and crates around farms / in fields
  for (int k = 0; k < 10; k++) {
    double cx = 260 + rng() * (W - 520);
    double cy = 50 + rng() * (H - 100);
    int n = 2 + (int)std::floor(rng() * 4);
    bool row = rng() < 0.5;
    for (int b = 0; b < n; b++) {
      double x = cx + (row ? b * 13 : (rng() - 0.5) * 40);
      double y = cy + (row ? 0 : (rng() - 0.5) * 40);
      if (!areaFree(g, (int)std::floor(x) - 6, (int)std::floor(y) - 6, 12, 12, 1) || onRoad(x, y) || avoid(x, y)) continue;
      uint8_t d = (uint8_t)std::floor(rng() * 4);
      disc(g, x, y, 5, [d](Grid& gg, int xx, int yy) { gg.setCell(xx, yy, M::HAY, d); });
    }
  }
  for (const auto& f : farms) {
    for (int c = 0; c < 3; c++) {
      int x = f.x + f.w + 4 + (c & 1) * 11, y = f.y + 10 + (c >> 1) * 11;
      if (areaFree(g, x, y, 10, 10, 1)) crate(g, x, y);
    }
  }

  // --- fuel drums
  for (int k = 0; k < 40 && L.barrels.size() < 5; k++) {
    double x, y;
    if (!farms.empty() && rng() < 0.6) {
      const Farm& f = farms[(size_t)std::floor(rng() * farms.size())];
      x = f.x - 10 + rng() * (f.w + 20);
      y = f.y + f.h + 10;
    } else {
      x = 300 + rng() * (W - 600);
      y = 40 + rng() * (H - 80);
    }
    int ix = (int)std::floor(x), iy = (int)std::floor(y);
    if (!areaFree(g, ix - 5, iy - 5, 10, 10, 2) || avoid(ix, iy)) continue;
    uint8_t id = (uint8_t)(L.barrels.size() + 1);
    for (int yy = -5; yy <= 5; yy++) for (int xx = -5; xx <= 5; xx++) if (xx * xx + yy * yy <= 20) g.setCell(ix + xx, iy + yy, M::BARREL, id);
    L.barrels.push_back({ix, iy, false});
  }

  // --- old shell craters: scorched, grass burnt off
  for (int k = 0; k < 16; k++) {
    double x = 260 + rng() * (W - 400);
    double y = 30 + rng() * (H - 60);
    double r = 6 + rng() * 10;
    for (int yy = (int)std::floor(y - r); yy <= y + r; yy++) for (int xx = (int)std::floor(x - r); xx <= x + r; xx++) {
      if (!g.inBounds(xx, yy)) continue;
      double d = std::hypot(xx - x, yy - y) / r;
      int i = yy * W + xx;
      uint8_t m = g.mat[i];
      if (d > 1 || m == M::HEDGE || m == M::HAY || m == M::STONE || m == M::BRICK) continue;
      if (m == M::GRASS) g.mat[i] = M::EMPTY;
      g.scorch[i] = d < 0.6 ? 2 : 1;
    }
  }

  // hp for everything written directly
  for (size_t i = 0; i < g.mat.size(); i++) if (g.mat[i] == M::GRASS) g.hp[i] = 1;

  auto types = roster(level, rng);
  L.enemies = placeEnemies(g, rng, spawn, flag, types);
  bakeDaylight(g, seed + 99);

  g.structSize.assign(SID + 1, 0);
  for (size_t i = 0; i < g.mat.size(); i++) {
    if (g.mat[i] == M::BRICK || g.mat[i] == M::STONE) g.structSize[g.structId[i]]++;
  }
  std::fill(g.dirty.begin(), g.dirty.end(), 1);
  g.touched.clear();
  g.hasNavBox = false;
  g.version++;
  return L;
}
